/**
 * Adds Shopify-sync columns to gift_cards and drops the unused shopify_location_id.
 * Safe to re-run — checks information_schema first.
 * Usage: node scripts/add-gc-shopify-columns.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

// Resolve tenant schemas
const schemas = new Set();
if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
const mainDb = process.env.MYSQL_DATABASE;
if (mainDb) {
  const [rows] = await conn.query(
    `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
  );
  for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
}
console.log(`Schemas: ${[...schemas].join(', ')}`);

for (const schema of schemas) {
  try {
    // Check existing columns
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_cards'`,
      [schema],
    );
    const existing = new Set(cols.map(c => c.COLUMN_NAME));

    const toAdd = [];
    if (!existing.has('shopify_gc_id'))
      toAdd.push(`ADD COLUMN shopify_gc_id        BIGINT      NULL COMMENT 'Shopify gift card numeric ID' AFTER id`);
    if (!existing.has('shopify_line_item_id'))
      toAdd.push(`ADD COLUMN shopify_line_item_id  BIGINT      NULL COMMENT 'Shopify line_item_id (order line)' AFTER shopify_gc_id`);
    if (!existing.has('expires_on'))
      toAdd.push(`ADD COLUMN expires_on            DATE        NULL COMMENT 'Card expiry date' AFTER status`);
    if (!existing.has('currency'))
      toAdd.push(`ADD COLUMN currency              VARCHAR(10) NOT NULL DEFAULT 'AUD' AFTER balance`);

    // Check if unique index on shopify_gc_id exists
    const [idxRows] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_cards' AND INDEX_NAME = 'uq_shopify_gc_id'`,
      [schema],
    );
    if (!idxRows.length)
      toAdd.push(`ADD UNIQUE KEY uq_shopify_gc_id (shopify_gc_id)`);

    const toDrop = [];
    if (existing.has('shopify_location_id'))
      toDrop.push(`DROP COLUMN shopify_location_id`);

    const allChanges = [...toAdd, ...toDrop];
    if (allChanges.length === 0) {
      console.log(`✓ ${schema}: already up to date`);
      continue;
    }

    await conn.query(`ALTER TABLE \`${schema}\`.gift_cards ${allChanges.join(', ')}`);
    console.log(`✓ ${schema}: applied ${allChanges.length} change(s): ${allChanges.map(c => c.split(' ').slice(0,3).join(' ')).join('; ')}`);
  } catch (e) {
    console.error(`✗ ${schema}:`, e.message);
  }
}

await conn.end();
console.log('Done.');
