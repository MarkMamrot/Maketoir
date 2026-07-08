/**
 * Migration: Shopify Returns API support + SO line item ID storage.
 *  A) ims_credit_notes: ADD shopify_return_id (Shopify Returns API id)
 *  B) ims_sales_order_items: ADD shopify_line_item_id (for linking returns to SO lines)
 * Safe to re-run. Usage: node scripts/add-shopify-returns-support.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = process.env.IMS_MYSQL_DATABASE;
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: db, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

async function hasColumn(table, column) {
  const [r] = await conn.query(
    `SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?`,
    [db, table, column]);
  return r[0].c > 0;
}
async function hasIndex(table, index) {
  const [r] = await conn.query(
    `SELECT COUNT(*) c FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?`,
    [db, table, index]);
  return r[0].c > 0;
}
async function addColumn(table, column, ddl) {
  if (await hasColumn(table, column)) { console.log('  =', `${table}.${column}`, 'exists'); return; }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log('  ✓', `${table}.${column}`);
}

// shopify_return_id — Shopify Returns API return id (links an approved return to a CN)
await addColumn('ims_credit_notes', 'shopify_return_id', `shopify_return_id VARCHAR(64) NULL AFTER shopify_refund_id`);

// shopify_line_item_id — lets us match Shopify return_line_items back to our SO items
await addColumn('ims_sales_order_items', 'shopify_line_item_id', `shopify_line_item_id BIGINT NULL AFTER so_id`);

// Unique index on shopify_return_id (idempotency).
if (!(await hasIndex('ims_credit_notes', 'uq_cn_shopify_return'))) {
  await conn.query(`ALTER TABLE ims_credit_notes ADD UNIQUE KEY uq_cn_shopify_return (business_id, shopify_return_id)`);
  console.log('  ✓ uq_cn_shopify_return');
} else console.log('  = uq_cn_shopify_return exists');

// Index for fast lookup of SO items by Shopify line item id.
if (!(await hasIndex('ims_sales_order_items', 'idx_soitem_shopify_li'))) {
  await conn.query(`ALTER TABLE ims_sales_order_items ADD KEY idx_soitem_shopify_li (shopify_line_item_id)`);
  console.log('  ✓ idx_soitem_shopify_li');
} else console.log('  = idx_soitem_shopify_li exists');

await conn.end();
console.log('Done.');
process.exit(0);
