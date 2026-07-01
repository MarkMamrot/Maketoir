import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

const [r] = await c.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_product_variants' AND COLUMN_NAME = 'shopify_inventory_item_id'`,
  [env.IMS_MYSQL_DATABASE]
);

if (r.length === 0) {
  await c.execute(`ALTER TABLE ims_product_variants ADD COLUMN shopify_inventory_item_id VARCHAR(100) NULL`);
  console.log('✅  Added shopify_inventory_item_id to ims_product_variants.');
} else {
  console.log('ℹ️  shopify_inventory_item_id already exists.');
}

await c.end();
