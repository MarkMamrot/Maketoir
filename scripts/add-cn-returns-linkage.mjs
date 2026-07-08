/**
 * Migration: unified returns ledger + Shopify order number.
 *  A) ims_sales_orders: ADD shopify_order_name (human #47497)
 *  B) ims_credit_notes: ADD so_id, original_so_number, source, shopify_refund_id (unique);
 *     MODIFY status ENUM to include 'awaiting_product'
 *  C) ims_credit_note_items: ADD restock
 * Safe to re-run. Usage: node scripts/add-cn-returns-linkage.mjs
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
  database: db, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
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

await addColumn('ims_sales_orders', 'shopify_order_name', `shopify_order_name VARCHAR(50) NULL AFTER shopify_order_id`);
await addColumn('ims_credit_notes', 'so_id', `so_id INT NULL AFTER customer_id`);
await addColumn('ims_credit_notes', 'original_so_number', `original_so_number VARCHAR(50) NULL AFTER so_id`);
await addColumn('ims_credit_notes', 'source', `source ENUM('manual','shopify') NOT NULL DEFAULT 'manual' AFTER status`);
await addColumn('ims_credit_notes', 'shopify_refund_id', `shopify_refund_id VARCHAR(64) NULL AFTER source`);
await addColumn('ims_credit_note_items', 'restock', `restock TINYINT(1) NOT NULL DEFAULT 1 AFTER price_basis`);

// Extend status enum (idempotent — re-applying is a no-op).
try {
  await conn.query(`ALTER TABLE ims_credit_notes MODIFY COLUMN status ENUM('draft','awaiting_product','complete') NOT NULL DEFAULT 'draft'`);
  console.log('  ✓ ims_credit_notes.status enum');
} catch (e) { console.log('  ✗ status enum —', e.message); }

if (!(await hasIndex('ims_credit_notes', 'uq_cn_shopify_refund'))) {
  await conn.query(`ALTER TABLE ims_credit_notes ADD UNIQUE KEY uq_cn_shopify_refund (business_id, shopify_refund_id)`);
  console.log('  ✓ uq_cn_shopify_refund');
} else console.log('  = uq_cn_shopify_refund exists');

if (!(await hasIndex('ims_credit_notes', 'idx_cn_so'))) {
  await conn.query(`ALTER TABLE ims_credit_notes ADD KEY idx_cn_so (business_id, so_id)`);
  console.log('  ✓ idx_cn_so');
} else console.log('  = idx_cn_so exists');

await conn.end();
console.log('Done.');
process.exit(0);
