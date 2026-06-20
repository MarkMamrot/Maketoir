import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCin7Credentials, resolveInventorySystemId, cin7FetchAllPages, sleep } from '@/lib/cin7Helpers';
import { ProductsRepository, StockRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

interface SalesAgg {
  qty7: number; rev7: number;
  qty90: number; rev90: number;
  qty180: number; rev180: number;
  qty12m: number; rev12m: number;
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, activeProductsOnly = true } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  let creds;
  try { creds = await getCin7Credentials(databaseId); }
  catch (e: any) { return NextResponse.json({ success: false, error: e.message }, { status: 400 }); }

  const inventorySystemId = await resolveInventorySystemId(databaseId);
  const syncedAt = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

  // 1. Fetch Products
  let products: any[];
  try {
    products = await cin7FetchAllPages(creds.authHeader, '/Products', {}, 'cin7/products');
    if (activeProductsOnly) products = products.filter(p => p.status === 'Public');
  } catch (e: any) { return NextResponse.json({ success: false, error: e.message }, { status: 502 }); }

  // 2. Fetch Stock
  let stockRecords: any[];
  try {
    stockRecords = await cin7FetchAllPages(creds.authHeader, '/Stock', {}, 'cin7/stock');
  } catch (e: any) {
    console.warn(`[products] Stock fetch failed: ${e.message}`);
    stockRecords = [];
  }

  // Aggregate stock by (productOptionId, branchId) — Cin7 can return multiple
  // sub-location (bin) rows for the same option+branch; sum them here.
  const stockAggMap = new Map<string, {
    product_option_id: string; branch_id: string; branch_name: string | null;
    code: string | null; name: string | null;
    soh: number; available: number; incoming: number;
    reorder_point: number | null; reorder_qty: number | null;
  }>();
  for (const s of stockRecords) {
    if (!s.productOptionId || !s.branchId) continue;
    const key = `${s.productOptionId}:${s.branchId}`;
    if (!stockAggMap.has(key)) {
      stockAggMap.set(key, {
        product_option_id: String(s.productOptionId),
        branch_id:         String(s.branchId),
        branch_name:       s.branchName ?? null,
        code:              s.code ?? null,
        name:              s.name ?? null,
        soh:               0, available: 0, incoming: 0,
        reorder_point:     s.reorderPoint != null ? Number(s.reorderPoint) : null,
        reorder_qty:       s.reorderQty   != null ? Number(s.reorderQty)   : null,
      });
    }
    const agg = stockAggMap.get(key)!;
    agg.soh       += Number(s.stockOnHand ?? 0);
    agg.available += Number(s.available   ?? 0);
    agg.incoming  += Number(s.incoming    ?? 0);
  }
  const aggregatedStock = Array.from(stockAggMap.values());

  // Write stock to MySQL
  try {
    await StockRepository.bulkReplace(
      inventorySystemId,
      aggregatedStock.map(s => ({ ...s, last_synced_at: syncedAt })),
    );
  } catch (e: any) {
    console.warn(`[products] Stock write failed: ${e.message}`);
  }

  // Build stock aggregation map
  const availMap = new Map<number, { soh: number; avail: number; inc: number }>();
  for (const s of stockRecords) {
    const optId = Number(s.productOptionId);
    if (!optId) continue;
    if (!availMap.has(optId)) availMap.set(optId, { soh: 0, avail: 0, inc: 0 });
    const st = availMap.get(optId)!;
    st.soh   += Number(s.stockOnHand ?? 0);
    st.avail += Number(s.available   ?? 0);
    st.inc   += Number(s.incoming    ?? 0);
  }

  // 3. Build sales aggregation from MySQL
  const salesMap = new Map<number, SalesAgg>();
  try {
    const now = Date.now();
    const fromDate = new Date(now - 365 * 86400_000).toISOString().slice(0, 10);
    const salesRows = await SalesRepository.query(inventorySystemId, { from: fromDate });
    const cut7 = now - 7 * 86400_000, cut90 = now - 90 * 86400_000,
          cut180 = now - 180 * 86400_000, cut12m = now - 365 * 86400_000;

    for (const row of salesRows) {
      const optId = Number(row.product_option_id);
      if (!optId) continue;
      const t = new Date(row.invoice_date).getTime();
      const qty = Number(row.qty) || 0;
      const rev = Number(row.line_total) || 0;
      if (isNaN(t) || t < cut12m) continue;
      if (!salesMap.has(optId)) {
        salesMap.set(optId, { qty7: 0, rev7: 0, qty90: 0, rev90: 0, qty180: 0, rev180: 0, qty12m: 0, rev12m: 0 });
      }
      const agg = salesMap.get(optId)!;
      agg.qty12m += qty; agg.rev12m += rev;
      if (t >= cut180) { agg.qty180 += qty; agg.rev180 += rev; }
      if (t >= cut90)  { agg.qty90  += qty; agg.rev90  += rev; }
      if (t >= cut7)   { agg.qty7   += qty; agg.rev7   += rev; }
    }
  } catch (e: any) {
    console.warn(`[products] Sales query failed: ${e.message}`);
  }

  // 4. Write products to MySQL — one row per product option
  const toUpsert: Omit<import('@/lib/db/ProductsRepository').ProductRow, 'business_id'>[] = [];

  for (const p of products) {
    const rawOpts: any[] = Array.isArray(p.productOptions) ? p.productOptions : [];
    for (const opt of rawOpts) {
      const optId = Number(opt?.id ?? opt?.productOptionId);
      if (!optId || isNaN(optId)) continue;

      const st = availMap.get(optId) ?? { soh: 0, avail: 0, inc: 0 };
      const sa = salesMap.get(optId) ?? { qty7:0, rev7:0, qty90:0, rev90:0, qty180:0, rev180:0, qty12m:0, rev12m:0 };

      const optionParts = [opt.option1, opt.option2, opt.option3].filter(Boolean);

      toUpsert.push({
        cin7_id:            String(p.id ?? ''),
        option_id:          String(optId),
        code:               opt.code ?? null,
        style_code:         p.styleCode ?? null,
        barcode:            opt.barcode ?? null,
        name:               p.name ?? null,
        brand:              p.brand ?? null,
        product_type:       (p.category || p.productType) ?? null,
        supplier_id:        p.supplierId ? String(p.supplierId) : null,
        option_label:       optionParts.length ? optionParts.join(' / ') : null,
        online:             (p.customFields?.products_1004 != null && p.customFields.products_1004 !== '') ? Number(p.customFields.products_1004) : null,
        pack_size:          p.customFields?.products_1005 ? Number(p.customFields.products_1005) : null,
        cost:               opt.priceColumns?.costAUD ?? opt.cost ?? null,
        retail_price:       opt.retailPrice ?? null,
        volume:             p.volume ?? null,
        created_date:       p.createdDate ? String(p.createdDate).slice(0, 10) : null,
        last_synced_at:     syncedAt,
        global_soh:         st.soh,
        global_available:   st.avail,
        global_incoming:    st.inc,
        sales_qty_7d:       sa.qty7,
        sales_qty_90d:      sa.qty90,
        sales_qty_180d:     sa.qty180,
        sales_qty_12m:      sa.qty12m,
        sales_revenue_7d:   sa.rev7,
        sales_revenue_90d:  sa.rev90,
        sales_revenue_180d: sa.rev180,
        sales_revenue_12m:  sa.rev12m,
      });
    }
  }

  try {
    await ProductsRepository.upsertBatch(inventorySystemId, toUpsert);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `DB write failed: ${e.message}` }, { status: 500 });
  }
  await ConfigRepository.set(databaseId, 'LastProductsSync', syncedAt);

  return NextResponse.json({ success: true, message: `${toUpsert.length} product options synced.` });
}

