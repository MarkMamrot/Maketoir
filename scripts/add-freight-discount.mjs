import mysql from 'mysql2/promise';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

const alters = [
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS freight DECIMAL(10,2) NOT NULL DEFAULT 0`, 'freight → ims_purchase_orders'],
  [`ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0`, 'discount → ims_purchase_orders'],
  [`ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS freight DECIMAL(10,2) NOT NULL DEFAULT 0`, 'freight → ims_sales_orders'],
  [`ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0`, 'discount → ims_sales_orders'],
];

for (const [sql, label] of alters) {
  await conn.execute(sql);
  console.log('Added', label);
}

await conn.end();
console.log('Done!');
