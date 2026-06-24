/**
 * Migration: add ims_payment_methods table + payment_method_id to payment tables
 * Run once: node scripts/add-payment-methods.mjs
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.IMS_MYSQL_DATABASE,
});

try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ims_payment_methods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(255) NOT NULL,
      name VARCHAR(100) NOT NULL,
      xero_account_code VARCHAR(50) NOT NULL DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_business_id (business_id)
    )
  `);
  console.log('✅ Created ims_payment_methods table');

  try {
    await conn.execute(`ALTER TABLE ims_purchase_order_payments ADD COLUMN payment_method_id INT NULL AFTER notes`);
    console.log('✅ Added payment_method_id to ims_purchase_order_payments');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  payment_method_id already on ims_purchase_order_payments — skipping');
    else throw e;
  }

  try {
    await conn.execute(`ALTER TABLE ims_sales_order_payments ADD COLUMN payment_method_id INT NULL AFTER notes`);
    console.log('✅ Added payment_method_id to ims_sales_order_payments');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  payment_method_id already on ims_sales_order_payments — skipping');
    else throw e;
  }
} finally {
  await conn.end();
}
