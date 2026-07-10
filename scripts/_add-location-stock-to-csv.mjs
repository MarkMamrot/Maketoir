/**
 * Reads an exported stock-turnover CSV, queries ims_stock per location for every
 * variant (matched by SKU / Code column), and writes a new CSV with one extra
 * column per active location appended to the right.
 *
 * Usage:
 *   node scripts/_add-location-stock-to-csv.mjs [input.csv] [output.csv]
 *
 * Defaults:
 *   input  → Downloads/stock-turnover (6).csv   (or first CLI arg)
 *   output → Downloads/stock-turnover-by-location.csv  (or second CLI arg)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import mysql from 'mysql2/promise';

const DEFAULT_INPUT  = path.join(os.homedir(), 'Downloads', 'stock-turnover (6).csv');
const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'stock-turnover-by-location.csv');

const inputPath  = process.argv[2] ?? DEFAULT_INPUT;
const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

// ── Read & parse CSV (simple split — handles quoted fields for the Name col) ──

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

const raw = fs.readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const allLines = raw.split('\n');

// Find the header row (first line starting with "Code,")
const headerIdx = allLines.findIndex(l => l.trim().startsWith('Code,'));
if (headerIdx === -1) {
  console.error('Could not find header row (expected to start with "Code,")');
  process.exit(1);
}

const headers   = parseCsvLine(allLines[headerIdx]);
const dataLines = allLines.slice(headerIdx + 1);

// Collect SKUs (Code column, index 0), skip blank/summary rows
const rows = [];
for (const line of dataLines) {
  if (!line.trim() || line.startsWith(',,,')) continue;  // skip blank / summary rows
  const fields = parseCsvLine(line);
  if (!fields[0]) continue;
  rows.push({ sku: fields[0].trim(), fields });
}

const skus = [...new Set(rows.map(r => r.sku).filter(Boolean))];
console.log(`Read ${rows.length} data rows, ${skus.length} unique SKUs.`);

// ── Connect to IMS DB ─────────────────────────────────────────────────────────

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// ── Fetch all active locations ────────────────────────────────────────────────

const [locRows] = await conn.execute(
  `SELECT id, name FROM ims_locations WHERE is_active = 1 ORDER BY name`,
);
const locations = locRows; // [{ id, name }]
console.log(`Locations (${locations.length}): ${locations.map(l => l.name).join(', ')}`);

// ── Fetch stock per variant per location, matched by SKU ─────────────────────

// Batch all SKUs in one query.
const ph = skus.map(() => '?').join(',');
const [stockRows] = await conn.execute(
  `SELECT v.sku, s.location_id, SUM(s.qty_on_hand) AS qty
     FROM ims_stock s
     JOIN ims_product_variants v ON v.variant_id = s.variant_id
    WHERE v.sku IN (${ph})
    GROUP BY v.sku, s.location_id`,
  skus,
);

await conn.end();

// Build a map: sku → { location_id → qty }
/** @type {Map<string, Map<number, number>>} */
const stockMap = new Map();
for (const r of stockRows) {
  if (!stockMap.has(r.sku)) stockMap.set(r.sku, new Map());
  stockMap.get(r.sku).set(Number(r.location_id), Number(r.qty ?? 0));
}

// ── Build output CSV ──────────────────────────────────────────────────────────

function quoteField(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const locHeaders = locations.map(l => l.name);
const outputHeaders = [...headers, ...locHeaders];

const outputLines = [outputHeaders.map(quoteField).join(',')];

for (const { sku, fields } of rows) {
  const locStock = stockMap.get(sku) ?? new Map();
  const locCols  = locations.map(l => String(locStock.get(l.id) ?? 0));
  outputLines.push([...fields.map(quoteField), ...locCols].join(','));
}

// Append the original summary/blank lines at the bottom (unchanged)
for (const line of dataLines) {
  if (!line.trim() || line.startsWith(',,,')) {
    // Add empty cells for the new location columns so columns stay aligned
    const emptyCols = locations.map(() => '').join(',');
    outputLines.push(line + (emptyCols ? ',' + emptyCols : ''));
  }
}

fs.writeFileSync(outputPath, outputLines.join('\n'), 'utf8');

console.log(`\n✅ Written to: ${outputPath}`);
console.log(`   ${rows.length} rows × ${locations.length} location columns added.`);
const matched   = rows.filter(r => stockMap.has(r.sku)).length;
const unmatched = rows.filter(r => !stockMap.has(r.sku)).length;
console.log(`   Matched: ${matched} / Unmatched (no stock record): ${unmatched}`);
if (unmatched > 0) {
  console.log('   Unmatched SKUs:', rows.filter(r => !stockMap.has(r.sku)).map(r => r.sku).join(', '));
}
