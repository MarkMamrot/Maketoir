/**
 * Diagnose why sales import entries are skipped.
 *
 * Checks:
 *   Reason 1 — Branch IDs in `sales` that have no matching ims_locations.cin7_branch_id
 *   Reason 3 — product_option_ids in `sales` that have no matching ims_product_variants.cin7_option_id
 *
 * Usage:
 *   node scripts/diagnose-sales-import.mjs [business_id]
 *
 * If business_id is omitted, it lists all distinct business_ids found in `sales` and exits.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const LEGACY_DB = process.env.MYSQL_DATABASE;
const IMS_DB    = process.env.IMS_MYSQL_DATABASE;
const CONN_OPTS = {
  host:     process.env.MYSQL_HOST,
  port:     +(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};

const businessId = process.argv[2] ?? null;

const legacy = await mysql.createConnection({ ...CONN_OPTS, database: LEGACY_DB });
const ims    = await mysql.createConnection({ ...CONN_OPTS, database: IMS_DB    });

// ─── If no business_id given, list available ones ────────────────────────────
if (!businessId) {
  const [rows] = await legacy.execute(
    `SELECT business_id, COUNT(DISTINCT order_id) AS order_count, COUNT(*) AS line_count
     FROM sales GROUP BY business_id ORDER BY order_count DESC`
  );
  console.log('\nNo business_id provided. Available in `sales` table:\n');
  console.table(rows);
  console.log('\nRe-run with: node scripts/diagnose-sales-import.mjs <business_id>\n');
  await legacy.end(); await ims.end();
  process.exit(0);
}

console.log(`\nDiagnosing sales import for business_id: ${businessId}\n`);
console.log('═'.repeat(70));

// ─── Summary counts ───────────────────────────────────────────────────────────
const [[summary]] = await legacy.execute(
  `SELECT COUNT(DISTINCT order_id) AS total_orders, COUNT(*) AS total_lines
   FROM sales WHERE business_id = ?`,
  [businessId]
);
console.log(`\nTotal in Cin7 cache: ${summary.total_orders} orders, ${summary.total_lines} lines\n`);

// ─── REASON 1: Missing branch → location mapping ─────────────────────────────
console.log('── REASON 1: Branch → Location mapping ─────────────────────────────');

const [allBranches] = await legacy.execute(
  `SELECT branch_id, COUNT(DISTINCT order_id) AS order_count, COUNT(*) AS line_count
   FROM sales WHERE business_id = ? GROUP BY branch_id ORDER BY order_count DESC`,
  [businessId]
);

const [imsLocations] = await ims.execute(
  `SELECT id, name, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL`
);
const locMap = new Map(imsLocations.map(l => [String(l.cin7_branch_id), l]));

let totalOrdersMapped = 0;
let totalOrdersUnmapped = 0;
const unmappedBranches = [];

for (const b of allBranches) {
  const loc = locMap.get(String(b.branch_id));
  if (loc) {
    totalOrdersMapped += b.order_count;
    console.log(`  ✓  branch_id ${b.branch_id} → ims_locations.id=${loc.id} "${loc.name}"  (${b.order_count} orders)`);
  } else {
    totalOrdersUnmapped += b.order_count;
    unmappedBranches.push(b);
    console.log(`  ✗  branch_id ${b.branch_id} → NO MATCH  (${b.order_count} orders, ${b.line_count} lines) — WILL BE SKIPPED`);
  }
}

console.log(`\n  Mapped:   ${totalOrdersMapped} orders`);
console.log(`  Skipped:  ${totalOrdersUnmapped} orders (reason 1)\n`);

// ─── REASON 3: Missing product_option_id → variant mapping ───────────────────
console.log('── REASON 3: Product Option → Variant mapping ───────────────────────');

const [allOptions] = await legacy.execute(
  `SELECT s.product_option_id, s.code, s.name,
          COUNT(DISTINCT s.order_id) AS order_count, COUNT(*) AS line_count
   FROM sales s
   WHERE s.business_id = ?
   GROUP BY s.product_option_id, s.code, s.name
   ORDER BY order_count DESC`,
  [businessId]
);

const [imsVariants] = await ims.execute(
  `SELECT variant_id, sku, cin7_option_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL`
);
const varMap = new Map(imsVariants.map(v => [String(v.cin7_option_id), v]));

let totalLinesMapped   = 0;
let totalLinesUnmapped = 0;
const unmappedOptions  = [];

for (const o of allOptions) {
  const v = varMap.get(String(o.product_option_id));
  if (v) {
    totalLinesMapped += o.line_count;
  } else {
    totalLinesUnmapped += o.line_count;
    unmappedOptions.push(o);
  }
}

if (unmappedOptions.length === 0) {
  console.log('  ✓  All product_option_ids are mapped — no line items will be dropped\n');
} else {
  console.log(`  ${unmappedOptions.length} product options have NO matching variant:\n`);
  for (const o of unmappedOptions) {
    console.log(`  ✗  option_id=${o.product_option_id}  code="${o.code}"  name="${o.name}"  (${o.order_count} orders, ${o.line_count} lines)`);
  }
  console.log(`\n  Mapped lines:   ${totalLinesMapped}`);
  console.log(`  Dropped lines:  ${totalLinesUnmapped} (reason 3)\n`);
}

// ─── IMS locations without cin7_branch_id (info) ─────────────────────────────
const [imsLocsAll] = await ims.execute(
  `SELECT id, name, cin7_branch_id FROM ims_locations ORDER BY id`
);
console.log('── IMS Locations table ──────────────────────────────────────────────');
console.table(imsLocsAll);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('═'.repeat(70));
console.log('SUMMARY');
console.log(`  Orders in Cin7:          ${summary.total_orders}`);
console.log(`  Orders that will import: ${totalOrdersMapped}`);
console.log(`  Orders that will SKIP:   ${totalOrdersUnmapped}  ← fix: map these branches to ims_locations`);
console.log(`  Lines that will DROP:    ${totalLinesUnmapped}    ← fix: import Products & Variants first`);
console.log('═'.repeat(70) + '\n');

await legacy.end();
await ims.end();
