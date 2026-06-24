/**
 * Migration: add supplier_invoice_date column to ims_purchase_orders
 * Run once: node scripts/add-supplier-invoice-date.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST,
  user: process.env.IMS_MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  port: process.env.IMS_MYSQL_PORT ? Number(process.env.IMS_MYSQL_PORT) : 3306,
  ssl: process.env.IMS_MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  await conn.execute(
    `ALTER TABLE ims_purchase_orders
     ADD COLUMN IF NOT EXISTS supplier_invoice_date DATE NULL
     AFTER supplier_invoice_number`
  );
  console.log('✓ Added supplier_invoice_date column to ims_purchase_orders');
} catch (err) {
  if (err.code === 'ER_DUP_FIELDNAME') {
    console.log('ℹ Column supplier_invoice_date already exists — skipping');
  } else {
    throw err;
  }
} finally {
  await conn.end();
}
