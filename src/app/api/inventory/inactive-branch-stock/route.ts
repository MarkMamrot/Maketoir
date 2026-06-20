import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { imsQuery } from '@/services/IMSMySQLService';
import { getInventorySource } from '@/lib/dataProvider';

function nc(v: unknown): string {
  return String(v ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * GET /api/inventory/inactive-branch-stock?databaseId=...
 *
 * Reads from locally-cached sheets (no Cin7 API calls):
 *   - Branches sheet  →  finds inactive branches
 *   - Stock sheet     →  finds SOH > 0 in those branches
 *   - Products sheet  →  looks up unit cost per optionId/code
 *
 * Returns:
 *   { success, branches: [{branchId, branchName, skuCount, totalQty, totalCost}], totals, rows }
 *   where `rows` are the individual stock lines for the detail table.
 */
export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  // ── Solvantis IMS path ────────────────────────────────────────────────────────
  const source = await getInventorySource(databaseId).catch(() => 'cin7');
  if (source === 'solvantis') {
    try {
      const inactiveLocs = await imsQuery<{ id: number; name: string }>(
        `SELECT id, name FROM ims_locations WHERE is_active = 0 ORDER BY name`,
      );
      if (inactiveLocs.length === 0) {
        return NextResponse.json({ success: true, branches: [], totals: { skuCount: 0, totalQty: 0, totalCost: 0 }, rows: [], message: 'No inactive locations found.' });
      }

      const locIds = inactiveLocs.map(l => l.id);
      const locMap = new Map(inactiveLocs.map(l => [l.id, l.name]));
      const placeholders = locIds.map(() => '?').join(',');

      type StockLine = { location_id: number; qty_on_hand: number; sku: string | null; cost_aud: number | null; product_name: string; brand: string | null };
      const stockRows = await imsQuery<StockLine>(
        `SELECT s.location_id, s.qty_on_hand, v.sku, v.cost_aud, p.name AS product_name, p.brand
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE s.location_id IN (${placeholders}) AND s.qty_on_hand > 0
         ORDER BY p.name`,
        locIds,
      );

      type OutRow = { code: string; name: string; brand: string; branchId: string; branchName: string; qty: number; unitCost: number; totalCost: number };
      const outRows: OutRow[] = [];
      const perBranch = new Map<string, { branchName: string; codes: Set<string>; qty: number; cost: number }>();

      for (const r of stockRows) {
        const branchName = locMap.get(r.location_id) ?? String(r.location_id);
        const branchId   = String(r.location_id);
        const unitCost   = Number(r.cost_aud ?? 0);
        const qty        = Number(r.qty_on_hand);
        outRows.push({ code: r.sku ?? '', name: r.product_name, brand: r.brand ?? '', branchId, branchName, qty, unitCost, totalCost: unitCost * qty });
        if (!perBranch.has(branchId)) perBranch.set(branchId, { branchName, codes: new Set(), qty: 0, cost: 0 });
        const b = perBranch.get(branchId)!;
        if (r.sku) b.codes.add(r.sku);
        b.qty  += qty;
        b.cost += unitCost * qty;
      }

      const branches = Array.from(perBranch.entries()).map(([branchId, b]) => ({
        branchId, branchName: b.branchName, skuCount: b.codes.size, totalQty: b.qty, totalCost: b.cost,
      }));
      const totals = branches.reduce((t, b) => ({ skuCount: t.skuCount + b.skuCount, totalQty: t.totalQty + b.totalQty, totalCost: t.totalCost + b.totalCost }), { skuCount: 0, totalQty: 0, totalCost: 0 });
      return NextResponse.json({ success: true, branches, totals, rows: outRows });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // ── Cin7 / Google Sheets path ─────────────────────────────────────────────────
  const sheets = new GoogleSheetsService();

  // Resolve inventory system spreadsheet
  let inventorySystemId = databaseId;
  try {
    const cfg = await sheets.getData(databaseId, 'Config!A:B') as string[][] | null;
    const row = cfg?.find(r => r[0] === 'Inventory System');
    if (row?.[1]) inventorySystemId = row[1];
  } catch { /* use databaseId */ }

  // ── 1. Inactive branches ────────────────────────────────────────────────────
  const branchRows = await sheets.getData(inventorySystemId, 'Branches').catch(() => null) as string[][] | null;
  if (!branchRows || branchRows.length < 2) {
    return NextResponse.json({ success: false, error: 'Branches sheet empty. Sync Branches first.' }, { status: 400 });
  }
  const bh = branchRows[0].map(nc);
  const bIdIdx   = bh.indexOf('id');
  const bNameIdx = bh.indexOf('name');
  const bActIdx  = bh.indexOf('isActive');

  const inactiveBranches = new Map<string, string>(); // branchId → branchName
  for (const row of branchRows.slice(1)) {
    const id     = nc(row[bIdIdx]);
    const name   = nc(row[bNameIdx]);
    const active = nc(row[bActIdx]).toLowerCase();
    if (id && active !== 'true') inactiveBranches.set(id, name || `Branch ${id}`);
  }

  if (inactiveBranches.size === 0) {
    return NextResponse.json({ success: true, branches: [], totals: { skuCount: 0, totalQty: 0, totalCost: 0 }, rows: [], message: 'No inactive branches found.' });
  }

  // ── 2. Cost lookup from Products sheet ─────────────────────────────────────
  const prodRows = await sheets.getData(inventorySystemId, 'Products').catch(() => null) as string[][] | null;
  const costByCode    = new Map<string, number>(); // variant code → unit cost
  const costByOptId   = new Map<string, number>(); // optionId     → unit cost
  const nameByCode    = new Map<string, string>();
  const brandByCode   = new Map<string, string>();
  if (prodRows && prodRows.length >= 2) {
    const ph      = prodRows[0].map(nc);
    const pOptIdx = ph.indexOf('optionid') >= 0 ? ph.indexOf('optionid') : ph.findIndex(h => h === 'optionid' || h === 'optionId');
    const pCodeIdx  = ph.findIndex(h => h.toLowerCase() === 'code');
    const pCostIdx  = ph.findIndex(h => h.toLowerCase() === 'cost');
    const pNameIdx  = ph.findIndex(h => h.toLowerCase() === 'name');
    const pBrandIdx = ph.findIndex(h => h.toLowerCase() === 'brand');

    for (const row of prodRows.slice(1)) {
      const code  = nc(row[pCodeIdx] ?? '');
      const optId = nc(row[pOptIdx]  ?? '');
      const cost  = parseFloat(nc(row[pCostIdx] ?? '').replace(/[$,]/g, '')) || 0;
      const name  = nc(row[pNameIdx] ?? '');
      const brand = nc(row[pBrandIdx] ?? '');
      if (code)  { costByCode.set(code,   cost); nameByCode.set(code, name); brandByCode.set(code, brand); }
      if (optId) { costByOptId.set(optId, cost); }
    }
  }

  // ── 3. Stock in inactive branches ───────────────────────────────────────────
  const stockRows = await sheets.getData(inventorySystemId, 'Stock').catch(() => null) as string[][] | null;
  if (!stockRows || stockRows.length < 2) {
    return NextResponse.json({ success: false, error: 'Stock sheet empty. Sync Products first.' }, { status: 400 });
  }
  const sh = stockRows[0].map(nc);
  const sOptIdx    = sh.findIndex(h => h.toLowerCase() === 'productoptionid');
  const sCodeIdx   = sh.findIndex(h => h.toLowerCase() === 'code');
  const sNameIdx   = sh.findIndex(h => h.toLowerCase() === 'name');
  const sBranchIdx = sh.findIndex(h => h.toLowerCase() === 'branchid');
  const sBrNmIdx   = sh.findIndex(h => h.toLowerCase() === 'branchname');
  const sSohIdx    = sh.findIndex(h => h.toLowerCase() === 'stockonhand');

  type StockLine = {
    code: string; name: string; brand: string;
    branchId: string; branchName: string;
    qty: number; unitCost: number; totalCost: number;
  };

  const lines: StockLine[] = [];
  const perBranch = new Map<string, { branchName: string; codes: Set<string>; qty: number; cost: number }>();

  for (const row of stockRows.slice(1)) {
    const branchId = nc(row[sBranchIdx] ?? '');
    if (!inactiveBranches.has(branchId)) continue;

    const soh = parseFloat(nc(row[sSohIdx] ?? '')) || 0;
    if (soh <= 0) continue;

    const code    = nc(row[sCodeIdx] ?? '');
    const optId   = nc(row[sOptIdx]  ?? '');
    const rawName = nc(row[sNameIdx] ?? '');
    const branchName = nc(row[sBrNmIdx] ?? '') || inactiveBranches.get(branchId) || branchId;

    const unitCost = costByCode.get(code) ?? costByOptId.get(optId) ?? 0;
    const productName  = nameByCode.get(code) || rawName;
    const brand        = brandByCode.get(code) || '';
    const totalLineCost = unitCost * soh;

    lines.push({ code, name: productName, brand, branchId, branchName, qty: soh, unitCost, totalCost: totalLineCost });

    if (!perBranch.has(branchId)) {
      perBranch.set(branchId, { branchName, codes: new Set(), qty: 0, cost: 0 });
    }
    const agg = perBranch.get(branchId)!;
    if (code) agg.codes.add(code);
    agg.qty  += soh;
    agg.cost += totalLineCost;
  }

  const branches = Array.from(perBranch.entries()).map(([branchId, a]) => ({
    branchId,
    branchName: a.branchName,
    skuCount:  a.codes.size,
    totalQty:  a.qty,
    totalCost: a.cost,
  })).sort((a, b) => b.totalCost - a.totalCost);

  const totals = {
    skuCount:  new Set(lines.map(l => l.code).filter(Boolean)).size,
    totalQty:  lines.reduce((s, l) => s + l.qty, 0),
    totalCost: lines.reduce((s, l) => s + l.totalCost, 0),
  };

  // Sort detail rows by cost desc
  lines.sort((a, b) => b.totalCost - a.totalCost);

  return NextResponse.json({ success: true, branches, totals, rows: lines });
}
