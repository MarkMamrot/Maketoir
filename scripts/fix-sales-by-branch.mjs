/**
 * Rewrites sync/sales-by-branch/route.ts to use MySQL repos.
 * File uses LF line endings.
 */
import { readFileSync, writeFileSync } from 'fs';

const path = 'src/app/api/sync/sales-by-branch/route.ts';
let c = readFileSync(path, 'utf8');
const nl = c.includes('\r\n') ? '\r\n' : '\n';
console.log('Line endings:', nl === '\r\n' ? 'CRLF' : 'LF');

// 1. Add imports (only if not already present)
const sheetsImport = "import { GoogleSheetsService } from '@/services/GoogleSheetsService';";
if (!c.includes("from '@/lib/db/BranchesAndSuppliersRepository'")) {
  c = c.replace(
    sheetsImport,
    sheetsImport +
    nl + "import { BranchesRepository } from '@/lib/db/BranchesAndSuppliersRepository';" +
    nl + "import { SalesRepository } from '@/lib/db/SalesRepository';" +
    nl + "import { resolveInventorySystemId } from '@/lib/cin7Helpers';"
  );
  console.log('Added imports');
} else {
  console.log('Imports already present');
}

// 2. Remove getActiveBranches function
const gaBranchStart = c.indexOf('\nasync function getActiveBranches(');
const gaBranchEnd   = c.indexOf('\n// Reads stock from');
if (gaBranchStart >= 0 && gaBranchEnd >= 0) {
  c = c.slice(0, gaBranchStart) + c.slice(gaBranchEnd);
  console.log('Removed getActiveBranches');
} else {
  console.log('getActiveBranches not found:', gaBranchStart, gaBranchEnd);
}

// 3. Change Map type annotations to string keys
c = c.replace('const infoMap = new Map<number, ProductInfo>();', 'const infoMap = new Map<string, ProductInfo>();');
c = c.replace('const statsMap = new Map<number, Map<number, SalesAgg>>();', 'const statsMap = new Map<string, Map<string, SalesAgg>>();');

// 4. Replace ensureAgg signature
const oldEnsureAgg = 'const ensureAgg = (optId: number, branchId: number) => {\n    if (!statsMap.has(optId)) statsMap.set(optId, new Map());\n    const bm = statsMap.get(optId)!;\n    if (!bm.has(branchId)) {';
const newEnsureAgg = 'const ensureAgg = (optKey: string, branchName: string) => {\n    if (!statsMap.has(optKey)) statsMap.set(optKey, new Map());\n    const bm = statsMap.get(optKey)!;\n    if (!bm.has(branchName)) {';
if (c.includes(oldEnsureAgg)) { c = c.replace(oldEnsureAgg, newEnsureAgg); console.log('Fixed ensureAgg signature'); }
else { console.log('ensureAgg not found'); }

c = c.replace('    return bm.get(branchId)!;\n  };', '    return bm.get(branchName)!;\n  };');

// 5. Replace Config+branches block in POST handler
const oldConfigBlock = `  let inventorySystemId = databaseId;
  
  try {
    const configRows = await sheets.getData(databaseId, 'Config!A:B');
    const invRow = (configRows as string[][])?.find(r => r[0] === 'Inventory System');
    if (invRow?.[1]) inventorySystemId = invRow[1];
  } catch {}

  const branches = await getActiveBranches(sheets, inventorySystemId);
  if (branches.length === 0) {
    return NextResponse.json({ success: false, error: 'No active branches found. Sync Branches first.' }, { status: 400 });
  }`;

const newConfigBlock = `  // Resolve Inventory System spreadsheet ID from MySQL config
  let inventorySystemId = databaseId;
  try {
    inventorySystemId = await resolveInventorySystemId(databaseId);
  } catch {}

  // Get active branches from MySQL
  const branchRows = await BranchesRepository.list(inventorySystemId);
  const branches: Branch[] = branchRows
    .map(b => ({
      id: (b.extra_json as any)?.id as number ?? 0,
      name: b.branch_name,
    }))
    .filter(b => !!b.name);

  const branchIdToName = new Map<number, string>();
  for (const b of branches) {
    if (b.id) branchIdToName.set(b.id, b.name);
  }

  if (branches.length === 0) {
    return NextResponse.json({ success: false, error: 'No active branches found. Sync Branches first.' }, { status: 400 });
  }`;

if (c.includes(oldConfigBlock)) {
  c = c.replace(oldConfigBlock, newConfigBlock);
  console.log('Replaced config+branches block');
} else {
  const trimOld = oldConfigBlock.replace('  \n', '\n');
  if (c.includes(trimOld)) {
    c = c.replace(trimOld, newConfigBlock);
    console.log('Replaced config+branches block (trim variant)');
  } else {
    console.log('Config block not found â€” checking content:');
    const i = c.indexOf('let inventorySystemId = databaseId;');
    console.log(JSON.stringify(c.slice(i - 5, i + 350)));
  }
}

// 6. Replace stock aggregation loop
const oldStockLoop = `  for (const s of stockData) {
    if (!infoMap.has(s.optId)) infoMap.set(s.optId, { code: s.code, name: s.name });
    const agg = ensureAgg(s.optId, s.branchId);
    agg.soh += s.soh;
    agg.minStock += s.minStock;
    agg.reorderQty += s.reorderQty;
  }`;
const newStockLoop = `  for (const s of stockData) {
    const optKey = String(s.optId);
    const branchName = branchIdToName.get(s.branchId) ?? '';
    if (!branchName) continue;
    if (!infoMap.has(optKey)) infoMap.set(optKey, { code: s.code, name: s.name });
    const agg = ensureAgg(optKey, branchName);
    agg.soh += s.soh;
    agg.minStock += s.minStock;
    agg.reorderQty += s.reorderQty;
  }`;
if (c.includes(oldStockLoop)) { c = c.replace(oldStockLoop, newStockLoop); console.log('Replaced stock loop'); }
else { console.log('Stock loop not found'); }

// 7. Replace Sales-from-Sheets with Sales-from-MySQL
const salesStart = c.indexOf('  // 2. Fetch Sales from Sheet');
const salesEnd   = c.indexOf('  const HEADERS = buildHeaders(branches);');
if (salesStart >= 0 && salesEnd >= 0) {
  const newSalesBlock = `  // 2. Fetch Sales from MySQL
  const now = Date.now();
  const cut12mDate = new Date(now - 365 * 86400_000).toISOString().slice(0, 10);
  const salesData = await SalesRepository.query(inventorySystemId, { from: cut12mDate });

  const cut7 = now - 7 * 86400_000;
  const cut90 = now - 90 * 86400_000;
  const cut180 = now - 180 * 86400_000;
  const cut12m = now - 365 * 86400_000;

  for (const sale of salesData) {
    const optKey = sale.product_option_id;
    const branchName = sale.branch_name ?? '';
    if (!optKey || !branchName) continue;

    const t = new Date(sale.order_date).getTime();
    if (isNaN(t)) continue;

    const qty = sale.qty;
    const rev = sale.line_total;

    if (!infoMap.has(optKey)) {
      infoMap.set(optKey, { code: '', name: sale.product_name ?? '' });
    }

    const agg = ensureAgg(optKey, branchName);
    agg.qty12m += qty;
    agg.rev12m += rev;
    if (t > agg.lastSold) agg.lastSold = t;
    if (t >= cut180) { agg.qty180 += qty; agg.rev180 += rev; }
    if (t >= cut90)  { agg.qty90  += qty; agg.rev90  += rev; }
    if (t >= cut7)   { agg.qty7   += qty; agg.rev7   += rev; }
  }

  `;
  c = c.slice(0, salesStart) + newSalesBlock + c.slice(salesEnd);
  console.log('Replaced sales block');
} else {
  console.log('Sales block not found:', salesStart, salesEnd);
}

// 8. Fix output loop: use optKey and b.name
const oldOuterLoop = `  const optIds = Array.from(statsMap.keys());
  
  for (const optId of optIds) {
    const info = infoMap.get(optId)!;
    const base = [ String(optId), info.code, info.name ];
    const branchCols: string[] = [];

    const bm = statsMap.get(optId)!;
    for (const b of branches) {
      const agg = bm.get(b.id);`;
const newOuterLoop = `  for (const optKey of statsMap.keys()) {
    const info = infoMap.get(optKey)!;
    const base = [optKey, info.code, info.name];
    const branchCols: string[] = [];

    const bm = statsMap.get(optKey)!;
    for (const b of branches) {
      const agg = bm.get(b.name);`;
if (c.includes(oldOuterLoop)) { c = c.replace(oldOuterLoop, newOuterLoop); console.log('Fixed output loop'); }
else {
  const trimOld = oldOuterLoop.replace('  \n', '\n');
  if (c.includes(trimOld)) { c = c.replace(trimOld, newOuterLoop); console.log('Fixed output loop (trim)'); }
  else {
    const i = c.indexOf('const optIds = Array.from(statsMap.keys())');
    console.log('Output loop area:', JSON.stringify(c.slice(i, i + 300)));
  }
}

// 9. Replace Online Sales section
const onlineStart = c.indexOf('  // â”€â”€ Online Sales sheet');
const onlineEnd   = c.indexOf('\n  return NextResponse.json({\n    success: true,\n    message: `Aggregated stock');
if (onlineStart >= 0 && onlineEnd >= 0) {
  const newOnline = `
  // â”€â”€ Online Sales sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ONLINE_SALES_HEADERS = ['orderId', 'orderDate', 'productOptionId', 'productName', 'branchName', 'customerName', 'qty', 'unitPrice', 'lineTotal', 'source'];
  const onlineRows: string[][] = salesData
    .filter(s => String(s.extra_json?.source ?? '').toLowerCase().startsWith('shopify'))
    .map(s => [
      s.order_id,
      s.order_date,
      s.product_option_id,
      s.product_name ?? '',
      s.branch_name ?? '',
      s.customer_name ?? '',
      String(s.qty),
      String(s.unit_price),
      String(s.line_total),
      String(s.extra_json?.source ?? ''),
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

`;
  c = c.slice(0, onlineStart) + newOnline + c.slice(onlineEnd);
  console.log('Replaced Online Sales block');
} else {
  console.log('Online Sales block not found:', onlineStart, onlineEnd);
}

writeFileSync(path, c, 'utf8');
console.log('\nDone.');
