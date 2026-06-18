/**
 * Migration: Add tax fields.
 *  - ims_contacts: charges_tax, prices_include_tax, tax_rate (supplier tax behaviour)
 *  - ims_purchase_orders: tax_code
 *  - ims_sales_orders: tax_code
 * Safe to re-run - uses ADD COLUMN IF NOT EXISTS.
 * Usage: node scripts/add-tax-fields.mjs
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
  [`ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS charges_tax TINYINT(1) NOT NULL DEFAULT 1`, 'ims_contacts.charges_tax'],
  [`ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS prices_include_tax TINYINT(1) NOT NULL DEFAULT 0`, 'ims_contacts.prices_include_tax'],
  [`ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(6,4) NULL`, 'ims_contacts.tax_rate'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS tax_code VARCHAR(50) NULL`, 'ims_purchase_orders.tax_code'],
  [`ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS tax_code VARCHAR(50) NULL`, 'ims_sales_orders.tax_code'],
];

for (const [sql, label] of columns) {
  try { await conn.execute(sql); console.log('OK  ' + label); }
  catch (e) { console.error('ERR ' + label + ' - ' + e.message); }
}

await conn.end();
console.log('\nDone.');
