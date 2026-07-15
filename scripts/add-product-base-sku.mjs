/**
 * Migration: add base_sku column to ims_products and seed it from style_code
 * where base_sku is NULL and style_code is present.
 *
 * Run once:  node scripts/add-product-base-sku.mjs
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

console.log('Connected to', process.env.MYSQL_DATABASE);

// 1. Add column (idempotent — check first since MySQL < 8.0 lacks IF NOT EXISTS)
const [cols] = await conn.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_products' AND COLUMN_NAME = 'base_sku'`
);
if (cols.length === 0) {
  await conn.execute(`ALTER TABLE ims_products ADD COLUMN base_sku VARCHAR(100) NULL`);
  console.log('Column base_sku added to ims_products');
} else {
  console.log('Column base_sku already exists — skipping ALTER');
}

// 2. Back-fill from style_code where base_sku is empty
const [result] = await conn.execute(`
  UPDATE ims_products
  SET    base_sku = style_code
  WHERE  (base_sku IS NULL OR base_sku = '')
    AND  style_code IS NOT NULL
    AND  style_code != ''
`);
console.log(`Seeded base_sku from style_code on ${result.affectedRows} row(s)`);

// 3. Back-fill from first variant SKU where still empty (single-variant products)
const [result2] = await conn.execute(`
  UPDATE ims_products p
  JOIN   ims_product_variants v ON v.product_id = p.product_id
  SET    p.base_sku = v.sku
  WHERE  (p.base_sku IS NULL OR p.base_sku = '')
    AND  v.sku IS NOT NULL AND v.sku != ''
`);
console.log(`Seeded base_sku from first variant SKU on ${result2.affectedRows} row(s)`);

await conn.end();
console.log('Done.');
