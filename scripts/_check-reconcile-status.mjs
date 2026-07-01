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

const [log] = await c.execute(`SELECT * FROM ims_shopify_sync_log ORDER BY created_at DESC LIMIT 10`);
console.log('Sync log entries:', log.length);
for (const r of log) console.log(JSON.stringify(r));

const [linked] = await c.execute(`SELECT COUNT(*) AS cnt FROM ims_products WHERE shopify_product_id IS NOT NULL`);
console.log('\nProducts with shopify_product_id set:', linked[0].cnt);

const [vlinked] = await c.execute(`SELECT COUNT(*) AS cnt FROM ims_product_variants WHERE shopify_variant_id IS NOT NULL`);
console.log('Variants with shopify_variant_id set:', vlinked[0].cnt);

await c.end();
