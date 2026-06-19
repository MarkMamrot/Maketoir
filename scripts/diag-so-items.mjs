/**
 * Compare SO 911103 items in our DB vs what Cin7 returns.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ── IMS DB ──────────────────────────────────────────────────────────────────
const imsConn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, database: process.env.IMS_MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
});

// Main DB (for Cin7 creds)
const mainConn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
});

// ── Get Cin7 creds ───────────────────────────────────────────────────────────
const [credRows] = await mainConn.execute('SELECT cin7_account_id, cin7_api_key FROM connections LIMIT 5');
let auth = null;
for (const r of credRows) {
  if (r.cin7_account_id && r.cin7_api_key) {
    auth = `Basic ${Buffer.from(`${r.cin7_account_id}:${decrypt(r.cin7_api_key)}`).toString('base64')}`;
    break;
  }
}
await mainConn.end();
if (!auth) { console.error('No Cin7 creds'); process.exit(1); }

// ── Our DB items for SO 911103 ───────────────────────────────────────────────
const [ourSO] = await imsConn.execute(
  `SELECT so.id, so.so_number, so.cin7_order_id FROM ims_sales_orders so
   WHERE so.so_number = '911103' OR so.cin7_order_id = '911103' LIMIT 1`,
);
console.log('Our SO row:', JSON.stringify(ourSO[0] ?? 'NOT FOUND'));

if (ourSO[0]) {
  const soId = ourSO[0].id;
  const [items] = await imsConn.execute(
    `SELECT i.id, i.variant_id, i.sku, i.product_name, i.qty_ordered, i.unit_price, i.line_total
     FROM ims_sales_order_items i WHERE i.so_id = ?`,
    [soId],
  );
  console.log(`\nOur DB items (${items.length}):`);
  items.forEach(i => console.log(`  variant=${i.variant_id} sku=${i.sku} name=${i.product_name?.slice(0,40)} qty=${i.qty_ordered} price=${i.unit_price}`));
}

// ── Cin7 line items for order 911103 ─────────────────────────────────────────
console.log('\nFetching Cin7 SO 911103...');
const res = await fetch(`https://api.cin7.com/api/v1/SalesOrders?rows=1&page=1&where=id=911103`, {
  headers: { Authorization: auth },
});
const data = await res.json();
if (!Array.isArray(data) || data.length === 0) {
  console.log('Cin7 response:', JSON.stringify(data).slice(0, 300));
  process.exit(0);
}

const so = data[0];
console.log(`\nCin7 SO: id=${so.id} ref=${so.reference} status=${so.status} stage=${so.stage}`);
const lines = Array.isArray(so.lineItems) ? so.lineItems : [];
console.log(`\nCin7 line items (${lines.length}):`);
lines.forEach((l, i) => {
  console.log(`  [${i}] optionId=${l.productOptionId} code=${l.code} name=${l.name?.slice(0,40)} qty=${l.qty} price=${l.unitPrice} lineTotal=${l.lineTotal ?? l.total}`);
});

// ── Cross-check: which Cin7 lines lack a variant in our DB? ──────────────────
const optionIds = lines.map(l => l.productOptionId).filter(Boolean);
const skus = lines.map(l => l.code).filter(Boolean);

if (optionIds.length > 0) {
  const [variants] = await imsConn.execute(
    `SELECT variant_id, cin7_option_id, sku FROM ims_product_variants WHERE cin7_option_id IN (${optionIds.map(() => '?').join(',')})`,
    optionIds,
  );
  const found = new Set(variants.map(v => v.cin7_option_id));
  console.log('\nVariant lookup by cin7_option_id:');
  lines.forEach(l => {
    const match = variants.find(v => v.cin7_option_id === l.productOptionId);
    const tag = match ? '✅' : '❌ MISSING';
    console.log(`  ${tag} optionId=${l.productOptionId} code=${l.code} → variant=${match?.variant_id ?? 'none'}`);
  });
}

await imsConn.end();
