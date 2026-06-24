/**
 * Migration: add supplier_invoice_date column to ims_purchase_orders
 * Run once: node scripts/add-supplier-invoice-date.mjs
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
  await conn.execute(
    `ALTER TABLE ims_purchase_orders
     ADD COLUMN supplier_invoice_date DATE NULL
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
