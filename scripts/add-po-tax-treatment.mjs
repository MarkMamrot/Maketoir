/**
 * Migration: Add tax_treatment + currency_code + exchange_rate to ims_purchase_orders.
 * Safe to re-run - uses ADD COLUMN IF NOT EXISTS.
 * Usage: node scripts/add-po-tax-treatment.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const columns = [
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS tax_treatment ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax'`, 'tax_treatment'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD'`, 'currency_code'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000`, 'exchange_rate'],
];

for (const [sql, label] of columns) {
  try { await conn.execute(sql); console.log('OK  ' + label); }
  catch (e) { console.error('ERR ' + label + ' - ' + e.message); }
}

await conn.end();
console.log('\nDone.');
