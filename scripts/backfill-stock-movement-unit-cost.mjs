/**
 * Backfill missing ims_stock_movements.unit_cost values used by COGS reporting.
 *
 * Default mode is conservative and only applies high-confidence updates:
 * - so_fulfilled: derive from ims_sales_order_items.unit_cost (same SO + variant)
 *
 * Optional heuristic mode (explicit opt-in):
 * - --include-pos-fallback: fill pos_sale rows from current ims_stock.avg_cost
 * - --include-stocktake-fallback: fill stocktake rows from current ims_stock.avg_cost
 * - --include-variant-fallback: fill remaining pos_sale/stocktake rows from
 *   COALESCE(ims_product_variants.avg_cost, ims_product_variants.cost_aud)
 *
 * Reporting:
 * - --report-unresolved: write remaining unresolved rows to JSON for manual triage
 * - --report-path=...: custom unresolved JSON output path
 *
 * Usage:
 *   node scripts/backfill-stock-movement-unit-cost.mjs
 *   node scripts/backfill-stock-movement-unit-cost.mjs --apply
 *   node scripts/backfill-stock-movement-unit-cost.mjs --apply --include-pos-fallback --include-stocktake-fallback
 *   node scripts/backfill-stock-movement-unit-cost.mjs --apply --include-pos-fallback --include-stocktake-fallback --include-variant-fallback
 *   node scripts/backfill-stock-movement-unit-cost.mjs --report-unresolved
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const INCLUDE_POS_FALLBACK = process.argv.includes('--include-pos-fallback');
const INCLUDE_STOCKTAKE_FALLBACK = process.argv.includes('--include-stocktake-fallback');
const INCLUDE_VARIANT_FALLBACK = process.argv.includes('--include-variant-fallback');
const REPORT_UNRESOLVED = process.argv.includes('--report-unresolved');
const REPORT_PATH_ARG = process.argv.find((a) => a.startsWith('--report-path='));
const REPORT_PATH = REPORT_PATH_ARG ? REPORT_PATH_ARG.split('=')[1] : 'scripts/backfill-stock-movement-unit-cost.unresolved.json';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

function short(v) {
  if (v == null) return '';
  const s = String(v);
  return s.length > 12 ? `${s.slice(0, 12)}...` : s;
}

try {
  await conn.beginTransaction();

  const [beforeRows] = await conn.execute(
    `SELECT movement_type, COUNT(*) AS n
       FROM ims_stock_movements
      WHERE unit_cost IS NULL
      GROUP BY movement_type
      ORDER BY n DESC`
  );
  console.log('Missing unit_cost rows by movement_type:');
  console.table(beforeRows);

  // 1) High-confidence backfill for so_fulfilled using stored SO item unit_cost.
  const [soPreview] = await conn.execute(
    `SELECT sm.id, sm.reference_id AS so_id, sm.variant_id, sm.location_id, sm.qty_change,
            soi.unit_cost AS derived_unit_cost
       FROM ims_stock_movements sm
       JOIN ims_sales_order_items soi
         ON soi.so_id = sm.reference_id
        AND soi.variant_id = sm.variant_id
      WHERE sm.movement_type = 'so_fulfilled'
        AND sm.unit_cost IS NULL
        AND soi.unit_cost IS NOT NULL
      ORDER BY sm.id
      LIMIT 30`
  );

  console.log(`\nso_fulfilled candidates (high confidence): ${soPreview.length} shown (max 30)`);
  if (soPreview.length) {
    console.table(
      soPreview.map((r) => ({
        id: r.id,
        so_id: r.so_id,
        variant: short(r.variant_id),
        loc: r.location_id,
        qty: Number(r.qty_change),
        unit_cost: Number(r.derived_unit_cost),
      }))
    );
  }

  const [soUpdateRes] = await conn.execute(
    `UPDATE ims_stock_movements sm
       JOIN ims_sales_order_items soi
         ON soi.so_id = sm.reference_id
        AND soi.variant_id = sm.variant_id
        SET sm.unit_cost = soi.unit_cost
      WHERE sm.movement_type = 'so_fulfilled'
        AND sm.unit_cost IS NULL
        AND soi.unit_cost IS NOT NULL`
  );
  console.log(`so_fulfilled rows backfilled: ${soUpdateRes.affectedRows}`);

  // 2) Optional fallback for POS movements from current avg_cost.
  let posUpdated = 0;
  if (INCLUDE_POS_FALLBACK) {
    const [posUpdateRes] = await conn.execute(
      `UPDATE ims_stock_movements sm
         JOIN ims_stock s
           ON s.variant_id = sm.variant_id
          AND s.location_id = sm.location_id
          AND (sm.business_id = s.business_id OR sm.business_id IS NULL OR sm.business_id = '')
          SET sm.unit_cost = s.avg_cost
        WHERE sm.movement_type = 'pos_sale'
          AND sm.unit_cost IS NULL
          AND s.avg_cost IS NOT NULL`
    );
    posUpdated = Number(posUpdateRes.affectedRows || 0);
    console.log(`pos_sale rows backfilled via CURRENT avg_cost fallback: ${posUpdated}`);
  } else {
    console.log('pos_sale fallback disabled (use --include-pos-fallback to enable heuristic fill).');
  }

  // 3) Optional fallback for stocktake movements from current avg_cost.
  let stocktakeUpdated = 0;
  if (INCLUDE_STOCKTAKE_FALLBACK) {
    const [stUpdateRes] = await conn.execute(
      `UPDATE ims_stock_movements sm
         JOIN ims_stock s
           ON s.variant_id = sm.variant_id
          AND s.location_id = sm.location_id
          AND (sm.business_id = s.business_id OR sm.business_id IS NULL OR sm.business_id = '')
          SET sm.unit_cost = s.avg_cost
        WHERE sm.movement_type = 'stocktake'
          AND sm.unit_cost IS NULL
          AND s.avg_cost IS NOT NULL`
    );
    stocktakeUpdated = Number(stUpdateRes.affectedRows || 0);
    console.log(`stocktake rows backfilled via CURRENT avg_cost fallback: ${stocktakeUpdated}`);
  } else {
    console.log('stocktake fallback disabled (use --include-stocktake-fallback to enable heuristic fill).');
  }

  // 4) Optional fallback from variant-level avg_cost/cost_aud for residual rows.
  let variantUpdated = 0;
  if (INCLUDE_VARIANT_FALLBACK) {
    const [variantUpdateRes] = await conn.execute(
      `UPDATE ims_stock_movements sm
         JOIN ims_product_variants pv
           ON pv.variant_id = sm.variant_id
          SET sm.unit_cost = COALESCE(pv.avg_cost, pv.cost_aud)
        WHERE sm.movement_type IN ('pos_sale', 'stocktake')
          AND sm.unit_cost IS NULL
          AND COALESCE(pv.avg_cost, pv.cost_aud) IS NOT NULL`
    );
    variantUpdated = Number(variantUpdateRes.affectedRows || 0);
    console.log(`pos_sale/stocktake rows backfilled via VARIANT fallback (avg_cost/cost_aud): ${variantUpdated}`);
  } else {
    console.log('variant fallback disabled (use --include-variant-fallback to enable residual fill).');
  }

  const [[remaining]] = await conn.execute(
    `SELECT COUNT(*) AS n
       FROM ims_stock_movements
      WHERE unit_cost IS NULL
        AND movement_type IN ('so_fulfilled', 'pos_sale', 'stocktake')`
  );
  console.log(`\nRemaining NULL unit_cost rows in COGS-relevant movement types: ${remaining.n}`);

  if (REPORT_UNRESOLVED) {
    const [unresolved] = await conn.execute(
      `SELECT sm.id, sm.business_id, sm.movement_type, sm.reference_type, sm.reference_id,
              sm.variant_id, pv.sku, sm.location_id, l.name AS location_name,
              sm.qty_change, sm.qty_after_soh, sm.created_at
         FROM ims_stock_movements sm
         LEFT JOIN ims_product_variants pv ON pv.variant_id = sm.variant_id
         LEFT JOIN ims_locations l ON l.id = sm.location_id
        WHERE sm.unit_cost IS NULL
          AND sm.movement_type IN ('so_fulfilled', 'pos_sale', 'stocktake')
        ORDER BY sm.created_at DESC, sm.id DESC`
    );
    fs.writeFileSync(REPORT_PATH, JSON.stringify(unresolved, null, 2));
    console.log(`Unresolved rows written to ${REPORT_PATH} (${unresolved.length} rows).`);
  }

  if (APPLY) {
    await conn.commit();
    console.log('\nAPPLIED.');
  } else {
    await conn.rollback();
    console.log('\nDRY RUN. No data changed. Re-run with --apply to commit.');
  }
} catch (err) {
  await conn.rollback();
  console.error('\nABORTED:', err?.message || err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
