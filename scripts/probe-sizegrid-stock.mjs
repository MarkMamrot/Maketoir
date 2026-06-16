/**
 * probe-sizegrid-stock.mjs
 * Checks what fields the Cin7 /Stock API returns for size-grid products
 * that have sku=NULL in IMS (can't be matched by code).
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// 1. Get cin7_option_id for a known null-sku product
const db = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const [rows] = await db.execute(
  `SELECT DISTINCT v.cin7_option_id, p.name
   FROM ims_product_variants v
   JOIN ims_products p ON p.product_id = v.product_id
   WHERE v.sku IS NULL AND p.name LIKE 'See You In Space Sherpa%'
   LIMIT 3`,
);

// Get Cin7 credentials from connections table
const BUSINESS_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const mainDb = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});
const [connRows] = await mainDb.execute(
  `SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id=? LIMIT 1`,
  [BUSINESS_ID],
);
await mainDb.end();
await db.end();

if (!connRows[0]) { console.log('No Cin7 connection found'); process.exit(1); }
const apiKey = decrypt(connRows[0].cin7_account_id);
const apiPass = decrypt(connRows[0].cin7_api_key);
const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiPass}`).toString('base64');

console.log('IMS cin7_option_ids for probe products:', rows.map(r => r.cin7_option_id));

const optionIds = rows.map(r => r.cin7_option_id).filter(Boolean);
if (optionIds.length === 0) {
  console.log('No cin7_option_ids found — aborting');
  process.exit(0);
}

// 3. Fetch from /Stock filtering by productOptionId
const url = `https://api.cin7.com/api/v1/Stock?rows=50&productOptionId=${optionIds[0]}`;
console.log('\nFetching:', url);
const res = await fetch(url, { headers: { Authorization: authHeader } });
const data = await res.json();

console.log(`\nReturned ${Array.isArray(data) ? data.length : 'non-array'} records`);
if (Array.isArray(data) && data.length > 0) {
  console.log('\nAll keys in first record:');
  console.log(Object.keys(data[0]).join(', '));
  console.log('\nAll records (full):');
  for (const r of data) console.log(JSON.stringify(r));
} else {
  console.log(JSON.stringify(data).slice(0, 500));
}

// 4. Also check the /Products endpoint to see what opt.option1 etc returns
const prodUrl = `https://api.cin7.com/api/v1/Products?where=productOptions.id%3D%3D${optionIds[0]}&rows=5`;
console.log('\n\nFetching products:', prodUrl);
const prodRes = await fetch(prodUrl, { headers: { Authorization: authHeader } });
const prodData = await prodRes.json();
if (Array.isArray(prodData) && prodData.length > 0) {
  const p = prodData[0];
  console.log('\nProduct optionLabel1:', p.optionLabel1);
  console.log('Product optionLabel2:', p.optionLabel2);
  console.log('Product optionLabel3:', p.optionLabel3);
  console.log('\nproductOptions (first 5):');
  for (const opt of (p.productOptions ?? []).slice(0, 5)) {
    console.log(JSON.stringify(opt));
  }
}
