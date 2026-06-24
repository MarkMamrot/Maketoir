// Migration: add customer_po_number to ims_sales_orders
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
    ALTER TABLE ims_sales_orders
    ADD COLUMN customer_po_number VARCHAR(100) NULL AFTER customer_id
  `);
  console.log('✅ Added customer_po_number column to ims_sales_orders');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('⚠️  Column customer_po_number already exists — skipping');
  } else {
    throw e;
  }
} finally {
  await conn.end();
}
