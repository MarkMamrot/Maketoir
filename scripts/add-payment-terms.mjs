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

await conn.execute('ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(100) NULL');
console.log('Added supplier_invoice_number to ims_purchase_orders');

await conn.execute('ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(20) NULL');
console.log('Added payment_terms to ims_purchase_orders');

await conn.execute('ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(20) NULL');
console.log('Added payment_terms to ims_sales_orders');

await conn.end();
console.log('Migration complete');
