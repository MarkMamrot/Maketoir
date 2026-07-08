/**
 * Backfill ims_sales_orders.shopify_order_name (human "#47497") for existing
 * online orders that only have shopify_order_id. Re-fetches names from Shopify
 * in batches of 250. Safe to re-run (only fills NULLs).
 *
 * Usage: node scripts/backfill-shopify-order-names.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, encHex] = parts;
  if (ivHex.length !== 24 || authTagHex.length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
}

const main = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});
const ims = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

// Businesses that have online orders missing a name.
const [biz] = await ims.query(
  `SELECT DISTINCT business_id FROM ims_sales_orders
    WHERE so_type='online' AND shopify_order_id IS NOT NULL AND shopify_order_id<>''
      AND (shopify_order_name IS NULL OR shopify_order_name='')`);
console.log('Businesses to backfill:', biz.length);

let totalUpdated = 0;
for (const { business_id } of biz) {
  const [[conn]] = await main.query(
    `SELECT shopify_shop_id, shopify_access_token FROM connections WHERE business_id=? LIMIT 1`, [business_id]);
  if (!conn?.shopify_shop_id || !conn?.shopify_access_token) { console.log(' - skip (no shopify):', business_id); continue; }
  const shop = String(conn.shopify_shop_id).replace(/\.myshopify\.com$/, '');
  const token = decrypt(conn.shopify_access_token);
  const base = `https://${shop}.myshopify.com/admin/api/2024-10`;

  const [rows] = await ims.query(
    `SELECT id, shopify_order_id FROM ims_sales_orders
      WHERE business_id=? AND so_type='online' AND shopify_order_id IS NOT NULL AND shopify_order_id<>''
        AND (shopify_order_name IS NULL OR shopify_order_name='')`, [business_id]);
  const ids = rows.map(r => String(r.shopify_order_id));
  console.log(` - ${business_id}: ${ids.length} orders`);

  for (let i = 0; i < ids.length; i += 250) {
    const batch = ids.slice(i, i + 250);
    const url = `${base}/orders.json?ids=${batch.join(',')}&status=any&fields=id,name,order_number&limit=250`;
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
    if (!res.ok) { console.log(`   HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
    const { orders } = await res.json();
    for (const o of (orders || [])) {
      const name = o.name ?? (o.order_number ? `#${o.order_number}` : null);
      if (!name) continue;
      const [r] = await ims.query(
        `UPDATE ims_sales_orders SET shopify_order_name=? WHERE business_id=? AND shopify_order_id=?`,
        [name, business_id, String(o.id)]);
      totalUpdated += r.affectedRows;
    }
  }
}

console.log('Total updated:', totalUpdated);
await main.end(); await ims.end();
process.exit(0);
