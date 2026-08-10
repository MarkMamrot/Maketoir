/**
 * Classify the six products verified during the July 2026 COGS audit as
 * non-stock. Dry-run by default and intentionally requires an explicit schema.
 *
 * Dry-run:
 *   node scripts/classify-monsterthreads-non-stock-products.mjs --schema=readyedu_MonsterthreadsIMS
 * Apply:
 *   node scripts/classify-monsterthreads-non-stock-products.mjs --schema=readyedu_MonsterthreadsIMS --apply
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDirectory, '..', '.env') });

const schemaArgument = process.argv.find(argument => argument.startsWith('--schema='));
const schema = schemaArgument?.slice('--schema='.length).trim() ?? '';
const apply = process.argv.includes('--apply');
if (!/^[A-Za-z0-9_]+$/.test(schema)) {
  throw new Error('Pass an explicit tenant schema using --schema=<schema_name>.');
}

const productNames = [
  'Gift Wrapping',
  'Misc Test Product',
  'Gift Voucher',
  'Shopify Misc Charge',
  'MISC Jewellery',
  'Petty Cash',
];
const expectedJulyMovementCount = 203;

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: schema,
  connectTimeout: 20000,
});

try {
  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_products' AND COLUMN_NAME = 'is_stock_item'`,
    [schema],
  );
  if (columnRows.length !== 1) {
    throw new Error(`${schema}.ims_products.is_stock_item is missing. Run catchup-schema-all-tenants.mjs first.`);
  }

  const placeholders = productNames.map(() => '?').join(',');
  const [products] = await connection.query(
    `SELECT p.product_id, p.name, p.is_stock_item, COUNT(DISTINCT pv.variant_id) AS variants
       FROM ims_products p
       LEFT JOIN ims_product_variants pv ON pv.product_id = p.product_id
      WHERE p.name IN (${placeholders})
      GROUP BY p.product_id, p.name, p.is_stock_item
      ORDER BY p.name, p.product_id`,
    productNames,
  );
  console.table(products);

  const matchedNames = new Set(products.map(product => String(product.name)));
  const missingNames = productNames.filter(name => !matchedNames.has(name));
  if (missingNames.length > 0) throw new Error(`Products not found: ${missingNames.join(', ')}`);
  if (products.length !== productNames.length) {
    throw new Error(`Expected exactly ${productNames.length} product rows but found ${products.length}; duplicate names must be resolved first.`);
  }

  const [auditRows] = await connection.query(
    `SELECT COUNT(*) AS movements, SUM(ABS(sm.qty_change)) AS quantity
       FROM ims_stock_movements sm
       LEFT JOIN pos_sales ps
         ON sm.movement_type = 'pos_sale' AND sm.reference_type = 'pos_sale' AND ps.id = sm.reference_id
       LEFT JOIN ims_sales_orders so
         ON sm.movement_type = 'so_fulfilled' AND sm.reference_type = 'sales_order' AND so.id = sm.reference_id
       JOIN ims_product_variants pv ON pv.variant_id = sm.variant_id
       JOIN ims_products p ON p.product_id = pv.product_id
      WHERE sm.created_at >= '2026-07-01' AND sm.created_at < '2026-08-01'
        AND sm.unit_cost <= 0
        AND sm.movement_type IN ('pos_sale', 'so_fulfilled')
        AND p.name IN (${placeholders})
        AND NOT (sm.movement_type = 'pos_sale' AND ps.id IS NULL)
        AND NOT (sm.movement_type = 'so_fulfilled' AND so.id IS NULL)
        AND NOT (sm.movement_type = 'pos_sale' AND COALESCE(ps.is_historical, 0) <> 0)
        AND NOT (sm.movement_type = 'so_fulfilled'
          AND (COALESCE(so.is_historical, 0) <> 0 OR so.cin7_order_id IS NOT NULL))`,
    productNames,
  );
  const julyMovementCount = Number(auditRows[0]?.movements ?? 0);
  console.table(auditRows);
  if (julyMovementCount !== expectedJulyMovementCount) {
    throw new Error(`Expected ${expectedJulyMovementCount} July movements but found ${julyMovementCount}; classification aborted.`);
  }

  if (!apply) {
    console.log('DRY RUN: no rows changed. Re-run with --apply after reviewing the product IDs above.');
  } else {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE ims_products SET is_stock_item = 0 WHERE name IN (${placeholders})`,
      productNames,
    );
    await connection.commit();
    console.log(`Applied non-stock classification to ${result.affectedRows} product rows in ${schema}.`);
  }
} catch (error) {
  await connection.rollback().catch(() => {});
  throw error;
} finally {
  await connection.end();
}