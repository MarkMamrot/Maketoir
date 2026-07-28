import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { buildProductMarginSalesQuery } from './query';

export async function GET(req: Request) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const brand       = searchParams.get('brand')       ?? '';
  const supplierId  = searchParams.get('supplierId')  ?? '';
  const productType = searchParams.get('productType') ?? '';
  const productId   = searchParams.get('productId')   ?? '';
  const win         = parseInt(searchParams.get('window') ?? '365', 10);
  const fromDate    = searchParams.get('from') ?? '';
  const toDate      = searchParams.get('to') ?? '';
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize    = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize') ?? '100', 10)));
  const offset      = (page - 1) * pageSize;

  const salesQuery = buildProductMarginSalesQuery({ window: win, fromDate, toDate });
  const conds: string[] = ['v.is_active = 1', 'p.is_active = 1', salesQuery.salesCondition];
  const filterParams: any[] = [];
  if (productId)   { conds.push('v.variant_id = ?');           filterParams.push(productId); }
  if (brand)       { conds.push('p.brand = ?');                filterParams.push(brand); }
  if (supplierId)  { conds.push('p.supplier_contact_id = ?');  filterParams.push(Number(supplierId)); }
  if (productType) { conds.push('p.product_type = ?');         filterParams.push(productType); }
  const where = 'WHERE ' + conds.join(' AND ');

  try {
    const countRows = await imsQuery<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      ${salesQuery.salesJoin}
      ${where}
    `, [...filterParams, ...salesQuery.queryParams]);
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await imsQuery<{
      sku: string;
      name: string;
      brand: string;
      cost: number;
      price: number;
      sales_qty: number;
    }>(`
      SELECT
        v.sku,
        p.name,
        p.brand,
        v.cost_aud AS cost,
        v.price_rrp AS price,
        ${salesQuery.salesQtyExpr} AS sales_qty
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      ${salesQuery.salesJoin}
      ${where}
      ORDER BY (${salesQuery.salesQtyExpr} * (v.price_rrp - v.cost_aud)) DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, [...filterParams, ...salesQuery.queryParams]);

    const data = rows.map(r => {
      const q     = Number(r.sales_qty ?? 0);
      const cost  = Number(r.cost  ?? 0);
      const price = Number(r.price ?? 0);
      const rev    = price * q;
      const cogs   = cost  * q;
      const profit = rev - cogs;
      const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
      return { sku: r.sku, name: r.name, brand: r.brand, cost, price, qty: q, rev, cogs, profit, margin };
    });

    return NextResponse.json({ success: true, data, total, page, pageSize });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
