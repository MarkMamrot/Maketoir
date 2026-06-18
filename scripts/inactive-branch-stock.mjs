/**
 * inactive-branch-stock.mjs
 *
 * Pulls Branches and Stock directly from the Cin7 API and finds all stock
 * lines where branchIsActive = false AND stockOnHand > 0.
 * Cross-references the Products API to get unit cost, then prints a summary
 * per inactive branch plus a grand total.
 *
 * Run:
 *   node scripts/inactive-branch-stock.mjs
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

// â”€â”€ Decrypt helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// â”€â”€ Google Sheets â€” load Cin7 credentials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const connRes = await sheetsApi.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = connRes.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const accountId = get('Cin7AccountId');
const apiKey    = decrypt(get('Cin7ApiKey'));
const authHeader = `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`;
console.log(`Cin7 auth: account=${accountId}, key=${apiKey ? '(OK)' : '(MISSING)'}\n`);

// â”€â”€ Cin7 pagination helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PAGE_SIZE = 250;
const DELAY_MS  = 1100; // stay under rate limit

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllPages(path, extraParams = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const url = new URL(`https://api.cin7.com/api/v1${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), { headers: { Authorization: authHeader } });
    if (res.status === 429) {
      console.warn('  429 rate limit â€” waiting 60s...');
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`Cin7 HTTP ${res.status} on ${path}`);
    const data = await res.json();

    const records = Array.isArray(data) ? data
      : Array.isArray(data?.data)       ? data.data
      : [];

    if (records.length === 0) break;
    all.push(...records);
    process.stdout.write(`  ${path} page ${page}: ${records.length} records (total ${all.length})\n`);
    if (records.length < PAGE_SIZE) break;
    page++;
    await sleep(DELAY_MS);
  }
  return all;
}

// â”€â”€ 1. Fetch all branches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('Fetching branches...');
const branches = await fetchAllPages('/Branches');

const inactiveBranches = new Map(); // id â†’ name
for (const b of branches) {
  const id     = String(b.id ?? b.ID ?? b.branchId ?? '');
  const name   = String(b.name ?? b.Name ?? b.branchName ?? b.company ?? id);
  const active = b.isActive ?? b.IsActive ?? b.active ?? true;
  if (id && !active) inactiveBranches.set(id, name);
}

console.log(`\nBranches total: ${branches.length}`);
console.log(`Inactive branches (${inactiveBranches.size}):`);
for (const [id, name] of inactiveBranches) {
  console.log(`  [${id}] ${name}`);
}

if (inactiveBranches.size === 0) {
  console.log('\nNo inactive branches found â€” nothing to do.');
  process.exit(0);
}

// â”€â”€ 2. Fetch all stock records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\nFetching stock (this may take a while)...');
const stockRecords = await fetchAllPages('/Stock');
console.log(`Stock records total: ${stockRecords.length}`);

// Filter to inactive branches with SOH > 0
const hitLines = stockRecords.filter(s => {
  const branchId = String(s.branchId ?? s.BranchId ?? '');
  const soh = Number(s.stockOnHand ?? s.StockOnHand ?? 0);
  return inactiveBranches.has(branchId) && soh > 0;
});
console.log(`Stock lines in inactive branches with SOH > 0: ${hitLines.length}`);

if (hitLines.length === 0) {
  console.log('\nNo stock found in inactive branches.');
  process.exit(0);
}

// â”€â”€ 3. Fetch product costs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Collect unique productOptionIds from the hit lines, then look up cost from Products.
// We fetch Products in full (they include productOptions with cost).
console.log('\nFetching products to look up unit costs...');
const products = await fetchAllPages('/Products');

// Build map: productOptionId â†’ cost
const costByOptId = new Map();
const nameByOptId = new Map();
const brandByOptId = new Map();
for (const p of products) {
  const brand = String(p.brand ?? p.Brand ?? '');
  for (const opt of (Array.isArray(p.productOptions) ? p.productOptions : [])) {
    const optId = String(opt.id ?? opt.productOptionId ?? '');
    const cost  = Number(opt.cost_aud ?? opt.cost_aud ?? 0);
    const name  = String(opt.name ?? p.name ?? p.Name ?? '');
    if (optId) {
      costByOptId.set(optId, cost);
      nameByOptId.set(optId, name);
      brandByOptId.set(optId, brand);
    }
  }
}
console.log(`Product options indexed: ${costByOptId.size}`);

// â”€â”€ 4. Summarise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const perBranch = new Map();
let grandQty = 0, grandCost = 0;
const uniqueSkus = new Set();

for (const s of hitLines) {
  const branchId   = String(s.branchId ?? s.BranchId ?? '');
  const branchName = inactiveBranches.get(branchId) ?? branchId;
  const optId      = String(s.productOptionId ?? s.ProductOptionId ?? '');
  const code       = String(s.code ?? s.Code ?? optId);
  const soh        = Number(s.stockOnHand ?? 0);
  const unitCost   = costByOptId.get(optId) ?? 0;
  const lineCost   = soh * unitCost;
  const name       = nameByOptId.get(optId) ?? String(s.name ?? '');
  const brand      = brandByOptId.get(optId) ?? '';

  uniqueSkus.add(code || optId);
  grandQty  += soh;
  grandCost += lineCost;

  if (!perBranch.has(branchId)) {
    perBranch.set(branchId, { branchName, lines: [], totalQty: 0, totalCost: 0, skus: new Set() });
  }
  const agg = perBranch.get(branchId);
  agg.lines.push({ code, name, brand, soh, unitCost, lineCost });
  agg.totalQty  += soh;
  agg.totalCost += lineCost;
  if (code || optId) agg.skus.add(code || optId);
}

// â”€â”€ 5. Print report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n' + 'â•'.repeat(70));
console.log('STOCK IN INACTIVE BRANCHES â€” REPORT');
console.log('â•'.repeat(70));

// Sort branches by cost descending
const sortedBranches = [...perBranch.values()].sort((a, b) => b.totalCost - a.totalCost);

for (const branch of sortedBranches) {
  console.log(`\nðŸ“¦ ${branch.branchName}`);
  console.log(`   SKUs: ${branch.skus.size}   Qty: ${branch.totalQty.toLocaleString()}   Cost: $${branch.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Sort lines by lineCost descending, show top 20
  const sorted = branch.lines.sort((a, b) => b.lineCost - a.lineCost);
  const shown  = sorted.slice(0, 20);
  console.log(`   Top ${Math.min(20, sorted.length)} lines by cost:`);
  for (const l of shown) {
    const costStr = l.unitCost > 0
      ? `unit=$${l.unitCost.toFixed(2)}  total=$${l.lineCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `(no cost)  total=$0`;
    console.log(`     ${String(l.code).padEnd(18)} ${l.name.slice(0, 35).padEnd(36)} qty=${l.soh}  ${costStr}`);
  }
  if (sorted.length > 20) {
    console.log(`     ... and ${sorted.length - 20} more lines`);
  }
}

console.log('\n' + 'â”€'.repeat(70));
console.log('GRAND TOTAL');
console.log(`  Inactive branches : ${sortedBranches.length}`);
console.log(`  Distinct SKUs     : ${uniqueSkus.size}`);
console.log(`  Total Qty         : ${grandQty.toLocaleString()}`);
console.log(`  Total Cost        : $${grandCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
console.log('â”€'.repeat(70));


