/**
 * Adds Xero OAuth columns to the connections table.
 * Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
 *
 * Usage:
 *   node scripts/add-xero-columns.mjs
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const alterations = [
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS gemini_model VARCHAR(100) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS ga4_property_id VARCHAR(50) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_client_id VARCHAR(255) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_redirect_uri VARCHAR(500) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_tenant_id VARCHAR(100) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_tenant_name VARCHAR(255) NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_access_token TEXT NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_refresh_token TEXT NULL`,
  `ALTER TABLE connections ADD COLUMN IF NOT EXISTS xero_token_expiry BIGINT NULL`,
];

for (const sql of alterations) {
  try {
    await conn.execute(sql);
    console.log('✅', sql.slice(0, 80));
  } catch (err) {
    console.error('❌', err.message);
  }
}

await conn.end();
console.log('\nDone.');
