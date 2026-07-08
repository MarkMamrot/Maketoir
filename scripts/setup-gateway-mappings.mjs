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
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_biz_gateway (business_id, gateway_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
console.log('✓ xero_gateway_mappings');

await conn.end();
console.log('Done.');
process.exit(0);
