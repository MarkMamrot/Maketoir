/**
 * Fast batch backfill: mark Cin7 online-retail SOs as so_type='online',
 * price_tier='retail', tax_treatment='inc_tax' and recompute stored totals
 * directly in SQL (no per-row round-trips).
 *
 * Runs in batches of 500, reconnecting each batch so a ECONNRESET can't
 * kill the whole job.
 *
 * Usage: node scripts/fix-so-online-retail-tax-fast.mjs
 */
import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const DB_CFG = {
  host:     process.env.IMS_MYSQL_HOST     ?? process.env.MYSQL_HOST,
  port:     Number(process.env.IMS_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 3306),
  user:     process.env.IMS_MYSQL_USER     ?? process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
  multipleStatements: true,
};

async function connect() {
  return mysql.createConnection(DB_CFG);
}

async function ensureColumns(conn) {
  const checks = [
    ['price_tier',    "ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS price_tier ENUM('retail','wholesale') NOT NULL DEFAULT 'retail'"],
    ['tax_treatment', "ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS tax_treatment ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax'"],
    ['so_type',       "ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS so_type VARCHAR(10) NOT NULL DEFAULT 'b2b'"],
  ];
  for (const [, ddl] of checks) {
    try { await conn.execute(ddl); } catch { /* already exists */ }
  }
}

// Get all affected SO IDs (a fast indexed scan)
async function getAffectedIds(conn) {
  const [rows] = await conn.execute(`
    SELECT so.id
      FROM ims_sales_orders so
      LEFT JOIN ims_contacts c ON c.id = so.customer_id
     WHERE so.so_type = 'online'
        OR (so.cin7_order_id IS NOT NULL
            AND so.shopify_order_id IS NULL
            AND LOWER(COALESCE(c.name,'')) = 'online shop sales')
     ORDER BY so.id
  `);
  return rows.map(r => r.id);
}

// Process a single batch of IDs entirely in SQL:
//   1. Compute inc-tax totals from line items in a subquery
//   2. UPDATE ims_sales_orders in one statement
async function processBatch(conn, ids) {
  if (ids.length === 0) return 0;
  const ph = ids.map(() => '?').join(',');

  // Aggregate line items: treat each line as tax-inclusive (10% GST default)
  // subtotal_ex = SUM(line / (1+rate)) where rate>0, else SUM(line)
  // tax_amount  = line - line/(1+rate) where rate>0
  const [result] = await conn.execute(`
    UPDATE ims_sales_orders so
    JOIN (
      SELECT
        soi.so_id,
        ROUND(SUM(
          CASE WHEN soi.tax_rate > 0
               THEN soi.line_total / (1 + soi.tax_rate)
               ELSE soi.line_total
          END
        ), 2) AS new_subtotal,
        ROUND(SUM(
          CASE WHEN soi.tax_rate > 0
               THEN soi.line_total - soi.line_total / (1 + soi.tax_rate)
               ELSE 0
          END
        ), 2) AS new_tax
      FROM ims_sales_order_items soi
      WHERE soi.so_id IN (${ph})
      GROUP BY soi.so_id
    ) totals ON totals.so_id = so.id
    SET
      so.so_type       = 'online',
      so.price_tier    = 'retail',
      so.tax_treatment = 'inc_tax',
      so.subtotal      = totals.new_subtotal,
      so.tax_amount    = totals.new_tax,
      so.total_amount  = ROUND(totals.new_subtotal + totals.new_tax
                              + COALESCE(so.freight, 0)
                              - COALESCE(so.discount, 0), 2),
      so.is_historical = CASE
                           WHEN so.cin7_order_id IS NOT NULL AND so.shopify_order_id IS NULL
                           THEN 1 ELSE so.is_historical
                         END
    WHERE so.id IN (${ph})
  `, [...ids, ...ids]);

  return result.affectedRows ?? 0;
}

// ── main ──────────────────────────────────────────────────────────────────────
const BATCH = 500;
let setup = await connect();
await ensureColumns(setup);
const allIds = await getAffectedIds(setup);
await setup.end();

console.log(`Found ${allIds.length} affected SOs. Processing in batches of ${BATCH}…`);

let totalUpdated = 0;
for (let i = 0; i < allIds.length; i += BATCH) {
  const batch = allIds.slice(i, i + BATCH);
  let conn;
  try {
    conn = await connect();
    const n = await processBatch(conn, batch);
    totalUpdated += n;
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: ids ${batch[0]}…${batch[batch.length - 1]} → ${n} updated (total so far: ${totalUpdated})`);
  } catch (err) {
    console.error(`  Batch ${Math.floor(i / BATCH) + 1} FAILED: ${err.message}`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

console.log(`\nDone. ${totalUpdated} sales orders updated.`);
