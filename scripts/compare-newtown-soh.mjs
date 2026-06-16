/**
 * compare-newtown-soh.mjs
 * Compares Cin7 SOH export (CSV) against IMS database for Newtown location.
 * Usage: node scripts/compare-newtown-soh.mjs [path-to-csv]
 * Default CSV path: C:\Users\mark\Downloads\newtowncin7SOH.csv
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

// ── Config ────────────────────────────────────────────────────────────────────
const CSV_PATH = process.argv[2] ?? 'C:\\Users\\mark\\Downloads\\newtowncin7SOH.csv';
const IMS_LOCATION_ID = 1; // Newtown Shop

// ── DB connection (same logic as IMSMySQLService) ─────────────────────────────
const db = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

// ── Parse CSV ─────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r/g, '').split('\n');
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // Handle quoted fields
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    const obj = {};
    header.forEach((h, idx) => obj[h] = cols[idx] ?? '');
    rows.push(obj);
  }
  return rows;
}

const csvText = fs.readFileSync(CSV_PATH, 'utf8');
const csvRows = parseCsv(csvText);

// Build map: sku → cin7 SOH
const cin7Map = new Map();
for (const row of csvRows) {
  const sku = row['Code']?.trim();
  const soh = parseInt(row['StockOnHand'] ?? '0', 10) || 0;
  if (!sku) continue;
  // If duplicate SKU rows (shouldn't happen), sum them
  cin7Map.set(sku, (cin7Map.get(sku) ?? 0) + soh);
}

// ── Query IMS ─────────────────────────────────────────────────────────────────
const [imsRows] = await db.execute(
  `SELECT v.sku, p.name AS product_name,
          CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
          s.qty_on_hand
   FROM ims_stock s
   JOIN ims_product_variants v ON v.variant_id = s.variant_id
   JOIN ims_products p ON p.product_id = v.product_id
   WHERE s.location_id = ?`,
  [IMS_LOCATION_ID],
);

// Build IMS map: sku → {qty_on_hand, product_name, variant_label}
const imsMap = new Map();
for (const r of imsRows) {
  if (r.sku) imsMap.set(r.sku, r);
}

await db.end();

// ── Compare ───────────────────────────────────────────────────────────────────
const DIFF_ONLY = true; // show only rows with discrepancies

const results = [];
let cin7Total = 0, imsTotal = 0, missingUnits = 0;
let notInIms = 0, notInCin7 = 0;

for (const [sku, cin7Soh] of cin7Map) {
  cin7Total += cin7Soh;
  const imsRow = imsMap.get(sku);
  const imsSoh = imsRow ? (Number(imsRow.qty_on_hand) || 0) : null;

  if (imsSoh === null) {
    // SKU not in IMS at all
    if (cin7Soh > 0) {
      results.push({ sku, cin7Soh, imsSoh: 'NOT IN IMS', diff: -cin7Soh, name: '' });
      missingUnits += cin7Soh;
      notInIms++;
    }
  } else {
    imsTotal += imsSoh;
    const diff = imsSoh - cin7Soh;
    if (diff !== 0) {
      results.push({
        sku,
        cin7Soh,
        imsSoh,
        diff,
        name: `${imsRow.product_name}${imsRow.variant_label ? ' — ' + imsRow.variant_label : ''}`,
      });
      if (diff < 0) missingUnits += Math.abs(diff);
    }
  }
}

// SKUs in IMS but not in CSV (with stock)
for (const [sku, imsRow] of imsMap) {
  if (!cin7Map.has(sku) && Number(imsRow.qty_on_hand) > 0) {
    imsTotal += Number(imsRow.qty_on_hand);
    results.push({
      sku,
      cin7Soh: 'NOT IN CSV',
      imsSoh: Number(imsRow.qty_on_hand),
      diff: Number(imsRow.qty_on_hand),
      name: `${imsRow.product_name}${imsRow.variant_label ? ' — ' + imsRow.variant_label : ''}`,
    });
    notInCin7++;
  }
}

// Sort: biggest shortfalls first (IMS missing most units vs Cin7)
results.sort((a, b) => {
  const da = typeof a.diff === 'number' ? a.diff : 0;
  const db2 = typeof b.diff === 'number' ? b.diff : 0;
  return da - db2; // most negative first
});

// ── Output ────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' Newtown SOH Comparison: Cin7 CSV  vs  IMS Database');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`CSV SKUs:          ${cin7Map.size.toLocaleString()}`);
console.log(`IMS SKUs (Newtown): ${imsMap.size.toLocaleString()}`);
console.log(`Cin7 total SOH:    ${cin7Total.toLocaleString()}`);
console.log(`IMS total SOH:     ${imsTotal.toLocaleString()}`);
console.log(`Difference:        ${(imsTotal - cin7Total).toLocaleString()} (negative = IMS missing units)`);
console.log(`\nSKUs in Cin7 but not in IMS (with SOH > 0): ${notInIms}`);
console.log(`SKUs in IMS but not in CSV (with SOH > 0): ${notInCin7}`);
console.log(`\nTotal IMS-missing units (cin7 > ims): ${missingUnits}`);

if (results.length === 0) {
  console.log('\n✓ No discrepancies found!\n');
} else {
  console.log(`\n${results.length} SKUs with discrepancies:\n`);
  console.log(
    'SKU'.padEnd(40) +
    'Cin7'.padStart(8) +
    'IMS'.padStart(10) +
    'Diff'.padStart(8) +
    '  Product',
  );
  console.log('─'.repeat(120));
  for (const r of results) {
    const cin7Str  = String(r.cin7Soh).padStart(8);
    const imsStr   = String(r.imsSoh).padStart(10);
    const diffStr  = (typeof r.diff === 'number' ? (r.diff > 0 ? '+' : '') + r.diff : '').padStart(8);
    const flagMissing = typeof r.diff === 'number' && r.diff < 0 ? ' ◄' : '';
    console.log(`${r.sku.padEnd(40)}${cin7Str}${imsStr}${diffStr}${flagMissing}  ${r.name}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
