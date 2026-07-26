/**
 * Setup: xero_gateway_mappings table — per-payment-gateway clearing accounts.
 * Each row maps one gateway name (as stored in ims_sales_orders.payment_gateway)
 * to a Xero clearing (bank) account code, and optionally a fee account.
 * Safe to re-run. Usage: node scripts/setup-gateway-mappings.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DATABASE, // main DB — same as xero_account_mappings
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS xero_gateway_mappings (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    business_id     VARCHAR(150) NOT NULL,
    gateway_name    VARCHAR(150) NOT NULL COMMENT 'Value as stored in ims_sales_orders.payment_gateway (case-insensitive LIKE match)',
    display_name    VARCHAR(150) NOT NULL COMMENT 'Friendly label shown in UI',
    clearing_account_code VARCHAR(50) NULL COMMENT 'Xero bank/clearing account code',
    clearing_account_name VARCHAR(150) NULL,
    fee_account_code VARCHAR(50) NULL COMMENT 'Optional: Xero expense account for gateway fees (handled manually if NULL)',
    fee_account_name VARCHAR(150) NULL,
    fee_tax_type VARCHAR(30) NULL COMMENT 'Xero tax type for gateway fees, e.g. INPUT or NONE',
    deduct_fee_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Post a calculated fee spend for each gross order payment',
    fixed_fee_amount DECIMAL(10,4) NOT NULL DEFAULT 0,
    percentage_fee_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT 'Percentage points, e.g. 1.5 means 1.5%',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_biz_gateway (business_id, gateway_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

const [feeTaxColumns] = await conn.query(`
  SELECT 1
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'xero_gateway_mappings'
     AND COLUMN_NAME = 'fee_tax_type'
   LIMIT 1`);
if (feeTaxColumns.length === 0) {
  await conn.query(`
    ALTER TABLE xero_gateway_mappings
      ADD COLUMN fee_tax_type VARCHAR(30) NULL
      COMMENT 'Xero tax type for gateway fees, e.g. INPUT or NONE'
      AFTER fee_account_name`);
}
const feeConfigColumns = [
  ['deduct_fee_enabled', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Post a calculated fee spend for each gross order payment' AFTER fee_tax_type"],
  ['fixed_fee_amount', 'DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER deduct_fee_enabled'],
  ['percentage_fee_rate', "DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT 'Percentage points, e.g. 1.5 means 1.5%' AFTER fixed_fee_amount"],
];
for (const [columnName, definition] of feeConfigColumns) {
  const [columns] = await conn.query(`
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'xero_gateway_mappings'
       AND COLUMN_NAME = ?
     LIMIT 1`, [columnName]);
  if (columns.length === 0) {
    await conn.query(`ALTER TABLE xero_gateway_mappings ADD COLUMN ${columnName} ${definition}`);
  }
}
console.log('✓ xero_gateway_mappings');

await conn.end();
console.log('Done.');
process.exit(0);
