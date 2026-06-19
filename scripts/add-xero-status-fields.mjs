/**
 * Migration: Add Xero sync status fields to PO and SO tables.
 *   - ims_purchase_orders: xero_bill_id, xero_synced_at, xero_sync_status
 *   - ims_sales_orders:    xero_invoice_id, xero_synced_at, xero_sync_status
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 * Usage: node scripts/add-xero-status-fields.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  database:       process.env.IMS_MYSQL_DATABASE,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const columns = [
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS xero_bill_id     VARCHAR(100)                           NULL AFTER total_amount`, 'ims_purchase_orders.xero_bill_id'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS xero_synced_at   DATETIME                               NULL AFTER xero_bill_id`,  'ims_purchase_orders.xero_synced_at'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS xero_sync_status ENUM('synced','queued','error')        NULL AFTER xero_synced_at`, 'ims_purchase_orders.xero_sync_status'],
  [`ALTER TABLE ims_sales_orders    ADD COLUMN IF NOT EXISTS xero_invoice_id  VARCHAR(100)                           NULL AFTER total_amount`, 'ims_sales_orders.xero_invoice_id'],
  [`ALTER TABLE ims_sales_orders    ADD COLUMN IF NOT EXISTS xero_synced_at   DATETIME                               NULL AFTER xero_invoice_id`, 'ims_sales_orders.xero_synced_at'],
  [`ALTER TABLE ims_sales_orders    ADD COLUMN IF NOT EXISTS xero_sync_status ENUM('synced','queued','error')        NULL AFTER xero_synced_at`,  'ims_sales_orders.xero_sync_status'],
];

for (const [sql, label] of columns) {
  try {
    await conn.execute(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}: ${e.message}`);
  }
}

await conn.end();
console.log('Done.');
