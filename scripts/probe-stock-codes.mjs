/**
 * probe-stock-codes.mjs
 * Find what `code` Cin7 /Stock uses for size-grid products (null opt.code).
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return stored ?? '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  d.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([d.update(Buffer.from(parts[2], 'hex')), d.final()]).toString('utf8');
}

const BUSINESS_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

const mainDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const [connRows] = await mainDb.execute(
  'SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id=? LIMIT 1', [BUSINESS_ID],
);
await mainDb.end();

const auth = 'Basic ' + Buffer.from(
  `${decrypt(connRows[0].cin7_account_id)}:${decrypt(connRows[0].cin7_api_key)}`
).toString('base64');

const imsDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// Get cin7_option_id values for known size-grid variants
const [imsVars] = await imsDb.execute(
  `SELECT sku, barcode, cin7_option_id FROM ims_product_variants WHERE sku LIKE 'SRS-SPA-%' LIMIT 5`
);
console.log('IMS SRS-SPA variants:');
imsVars.forEach(r => console.log(`  sku="${r.sku}" barcode="${r.barcode}" cin7_option_id=${r.cin7_option_id}`));

// Probe /Stock by barcode (single quotes required)
const barcode = imsVars[0]?.barcode;
if (barcode) {
  const url = `https://api.cin7.com/api/v1/Stock?rows=20&where=(barcode='${barcode}')`;
  console.log(`\nFetching: ${url}`);
  const res = await fetch(url, { headers: { Authorization: auth } });
  const data = await res.json();
  console.log(`Returned ${Array.isArray(data) ? data.length : 'non-array'} records`);
  if (Array.isArray(data)) data.forEach(r => console.log(JSON.stringify(r)));
  else console.log(JSON.stringify(data).slice(0, 400));
}

await new Promise(r => setTimeout(r, 500));

// Probe /Stock by productOptionId
const optId = imsVars[0]?.cin7_option_id;
if (optId) {
  const url2 = `https://api.cin7.com/api/v1/Stock?rows=20&productOptionId=${optId}`;
  console.log(`\nFetching: ${url2}`);
  const res2 = await fetch(url2, { headers: { Authorization: auth } });
  const data2 = await res2.json();
  console.log(`Returned ${Array.isArray(data2) ? data2.length : 'non-array'} records`);
  if (Array.isArray(data2)) data2.forEach(r => console.log(JSON.stringify(r)));
  else console.log(JSON.stringify(data2).slice(0, 400));
}

await new Promise(r => setTimeout(r, 500));

// Also probe by productId for SRS-SPA-ish products
// Find the cin7_product_id for a product with these variants
const [prodRows] = await imsDb.execute(
  `SELECT p.cin7_product_id, p.name FROM ims_products p
   JOIN ims_product_variants v ON v.product_id = p.product_id
   WHERE v.sku LIKE 'SRS-SPA-%' LIMIT 1`
);
const cin7ProductId = prodRows[0]?.cin7_product_id;
console.log(`\nCin7 product_id for SRS-SPA: ${cin7ProductId} (${prodRows[0]?.name})`);

if (cin7ProductId) {
  await new Promise(r => setTimeout(r, 500));
  const url3 = `https://api.cin7.com/api/v1/Stock?rows=20&productId=${cin7ProductId}`;
  console.log(`Fetching: ${url3}`);
  const res3 = await fetch(url3, { headers: { Authorization: auth } });
  const data3 = await res3.json();
  console.log(`Returned ${Array.isArray(data3) ? data3.length : 'non-array'} records`);
  if (Array.isArray(data3)) {
    if (data3.length > 0) {
      console.log('Keys:', Object.keys(data3[0]).join(', '));
      data3.forEach(r => console.log(JSON.stringify(r)));
    }
  } else console.log(JSON.stringify(data3).slice(0, 400));
}

await imsDb.end();
