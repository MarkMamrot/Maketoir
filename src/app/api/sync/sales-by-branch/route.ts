import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { BranchesRepository } from '@/lib/db/BranchesAndSuppliersRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { StockRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

const SHEET = 'Sales by Branch';

const BRANCH_FIELDS = [
  'SOH', 'Min Stock', 'Reorder Qty',
  'Sales Qty - Last 7 Days', 'Revenue - Last 7 Days',
  'Sales Qty - Last 90 Days', 'Revenue - Last 90 Days',
  'Sales Qty - Last 180 Days', 'Revenue - Last 180 Days',
  'Sales Qty - Last 12 Months', 'Revenue - Last 12 Months',
  'Last Sale Date',
];

interface Branch { id: number; name: string; }
interface SalesAgg { 
  qty7: number; rev7: number; qty90: number; rev90: number; qty180: number; rev180: number; qty12m: number; rev12m: number; lastSold: number;
  soh: number; minStock: number; reorderQty: number;
}
interface ProductInfo { code: string; name: string; }

function buildHeaders(branches: Branch[]): string[] {
  return [
    'productOptionId', 'code', 'name',
    ...branches.flatMap(b => BRANCH_FIELDS.map(f => `${b.name} ${f}`)),
  ];
}

// Reads stock from MySQL (written by the Products sync).
async function readStockMySQL(inventorySystemId: string): Promise<{
  optId: number; branchId: number; code: string; name: string;
  soh: number; minStock: number; reorderQty: number;
}[]> {
  try {
    const rows = await StockRepository.list(inventorySystemId);
    return rows
      .map(r => ({
        optId:      Number(r.product_option_id),
        branchId:   Number(r.branch_id ?? 0),
        code:       r.code ?? '',
        name:       r.name ?? '',
        soh:        Number(r.soh ?? 0),
        minStock:   Number(r.reorder_point ?? 0),
        reorderQty: Number(r.reorder_qty   ?? 0),
      }))
      .filter(r => r.optId && r.branchId);
  } catch { return []; }
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  const sheets = new GoogleSheetsService();
  
  // Resolve Inventory System spreadsheet ID from MySQL config
  let inventorySystemId = databaseId;
  try {
    inventorySystemId = await resolveInventorySystemId(databaseId);
  } catch {}

  // Get active branches from MySQL
  const branchRows = await BranchesRepository.list(inventorySystemId);
  const branches: Branch[] = branchRows
    .map(b => ({
      id: Number(b.cin7_id ?? 0),
      name: b.name,
    }))
    .filter(b => !!b.name);

  const branchIdToName = new Map<number, string>();
  for (const b of branches) {
    if (b.id) branchIdToName.set(b.id, b.name);
  }

  if (branches.length === 0) {
    return NextResponse.json({ success: false, error: 'No active branches found. Sync Branches first.' }, { status: 400 });
  }

  const infoMap = new Map<string, ProductInfo>();
  const statsMap = new Map<string, Map<string, SalesAgg>>();
  const ensureAgg = (optKey: string, branchName: string) => {
    if (!statsMap.has(optKey)) statsMap.set(optKey, new Map());
    const bm = statsMap.get(optKey)!;
    if (!bm.has(branchName)) {
      bm.set(branchName, { qty7: 0, rev7: 0, qty90: 0, rev90: 0, qty180: 0, rev180: 0, qty12m: 0, rev12m: 0, lastSold: 0, soh: 0, minStock: 0, reorderQty: 0 });
    }
    return bm.get(branchName)!;
  };

  // 1. Read Stock from MySQL (written by the Products sync — no Cin7 call here)
  const stockData = await readStockMySQL(inventorySystemId);
  for (const s of stockData) {
    const optKey = String(s.optId);
    const branchName = branchIdToName.get(s.branchId) ?? '';
    if (!branchName) continue;
    if (!infoMap.has(optKey)) infoMap.set(optKey, { code: s.code, name: s.name });
    const agg = ensureAgg(optKey, branchName);
    agg.soh += s.soh;
    agg.minStock += s.minStock;
    agg.reorderQty += s.reorderQty;
  }

  // 2. Fetch Sales from MySQL
  const now = Date.now();
  const cut12mDate = new Date(now - 365 * 86400_000).toISOString().slice(0, 10);
  const salesData = await SalesRepository.query(inventorySystemId, { from: cut12mDate });

  const cut7 = now - 7 * 86400_000;
  const cut90 = now - 90 * 86400_000;
  const cut180 = now - 180 * 86400_000;
  const cut12m = now - 365 * 86400_000;

  for (const sale of salesData) {
    const optKey = sale.product_option_id;
    const branchName = branchIdToName.get(Number(sale.branch_id)) ?? sale.branch_id ?? '';
    if (!optKey || !branchName) continue;

    const t = new Date(sale.invoice_date).getTime();
    if (isNaN(t)) continue;

    const qty = Number(sale.qty);
    const rev = Number(sale.line_total);

    if (!infoMap.has(optKey)) {
      infoMap.set(optKey, { code: sale.code ?? '', name: sale.name ?? '' });
    }

    const agg = ensureAgg(optKey, branchName);
    agg.qty12m += qty;
    agg.rev12m += rev;
    if (t > agg.lastSold) agg.lastSold = t;
    if (t >= cut180) { agg.qty180 += qty; agg.rev180 += rev; }
    if (t >= cut90)  { agg.qty90  += qty; agg.rev90  += rev; }
    if (t >= cut7)   { agg.qty7   += qty; agg.rev7   += rev; }
  }

    const HEADERS = buildHeaders(branches);
  const rows: string[][] = [];
  const num = (v: any) => (v != null && v !== 0 && !isNaN(v) ? String(v) : '');

  for (const optKey of statsMap.keys()) {
    const info = infoMap.get(optKey)!;
    const base = [optKey, info.code, info.name];
    const branchCols: string[] = [];

    const bm = statsMap.get(optKey)!;
    for (const b of branches) {
      const agg = bm.get(b.name);
      if (agg) {
        branchCols.push(
          num(agg.soh),
          num(agg.minStock),
          num(agg.reorderQty),
          num(agg.qty7),
          agg.qty7 ? num(agg.rev7.toFixed(2)) : '',
          num(agg.qty90),
          agg.qty90 ? num(agg.rev90.toFixed(2)) : '',
          num(agg.qty180),
          agg.qty180 ? num(agg.rev180.toFixed(2)) : '',
          num(agg.qty12m),
          agg.qty12m ? num(agg.rev12m.toFixed(2)) : '',
          agg.lastSold ? new Date(agg.lastSold).toISOString().slice(0, 10) : '',
        );
      } else {
        branchCols.push('', '', '', '', '', '', '', '', '', '', '', '');
      }
    }
    
    rows.push([...base, ...branchCols]);
  }

  try {
    await sheets.resetSheet(inventorySystemId, SHEET, HEADERS);
    if (rows.length > 0) {
      await sheets.appendData(inventorySystemId, `${SHEET}!A1`, rows);
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to write: ${e.message}` }, { status: 500 });
  }

  // ── Online Sales sheet ─────────────────────────────────────────────────────
  const ONLINE_SALES_HEADERS = ['orderId', 'orderDate', 'productOptionId', 'productName', 'branchName', 'customerName', 'qty', 'unitPrice', 'lineTotal', 'source'];
  const onlineRows: string[][] = salesData
    .filter(s => String(s.source ?? '').toLowerCase().startsWith('shopify'))
    .map(s => [
      s.order_id,
      s.invoice_date,
      s.product_option_id,
      s.name ?? '',
      branchIdToName.get(Number(s.branch_id)) ?? s.branch_id ?? '',
      s.member_id ?? '',
      String(s.qty),
      String(s.unit_price),
      String(s.line_total),
      String(s.source ?? ''),
    ]);
  let onlineSalesWritten = 0;
  try {
    await sheets.addSheetIfNotExists(inventorySystemId, 'Online Sales', ONLINE_SALES_HEADERS);
    await sheets.clearSheetContent(inventorySystemId, 'Online Sales');
    await sheets.updateData(inventorySystemId, 'Online Sales!A1', [ONLINE_SALES_HEADERS, ...onlineRows]);
    onlineSalesWritten = onlineRows.length;
  } catch (e: any) {
    console.warn('[sync/sales-by-branch] Failed to write Online Sales sheet:', e.message);
  }

  return NextResponse.json({
    success: true,
    message: `Aggregated stock & sales for ${rows.length} product variants. Online Sales: ${onlineSalesWritten} rows written.`,
  });
}
