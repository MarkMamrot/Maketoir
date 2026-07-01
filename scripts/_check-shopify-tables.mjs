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

const tables = ['ims_product_images', 'ims_shopify_sync_log'];
for (const t of tables) {
  const [r] = await c.execute(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [env.IMS_MYSQL_DATABASE, t]
  );
  console.log(`${t}: ${r[0].cnt > 0 ? '✅ exists' : '❌ MISSING'}`);
}

// Also check key columns on ims_product_images
const [cols] = await c.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_product_images' ORDER BY ORDINAL_POSITION`,
  [env.IMS_MYSQL_DATABASE]
);
if (cols.length) {
  console.log('ims_product_images columns:', cols.map(r => r.COLUMN_NAME).join(', '));
}

await c.end();
