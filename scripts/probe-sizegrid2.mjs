import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return stored;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

const BUSINESS_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

const mainDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const [[conn]] = await mainDb.execute(
  'SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id=? LIMIT 1',
  [BUSINESS_ID],
);
await mainDb.end();

const accountId = conn.cin7_account_id; // not encrypted
const apiKey = decrypt(conn.cin7_api_key);
const authHeader = 'Basic ' + Buffer.from(`${accountId}:${apiKey}`).toString('base64');

// Pick cin7_product_id for "See You In Space Sherpa Jumpsuit" (cin7_option_id=17474)
const imsDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const [[prodRow]] = await imsDb.execute(
  `SELECT p.cin7_product_id FROM ims_products p
   JOIN ims_product_variants v ON v.product_id = p.product_id
   WHERE v.sku IS NULL AND p.name LIKE 'See You In Space Sherpa%' LIMIT 1`,
);
await imsDb.end();

console.log('cin7_product_id:', prodRow?.cin7_product_id);

// Fetch the product from Cin7
const prodUrl = `https://api.cin7.com/api/v1/Products?rows=1&id=${prodRow.cin7_product_id}`;
console.log('Fetching:', prodUrl);
const prodRes = await fetch(prodUrl, { headers: { Authorization: authHeader } });
const prodJson = await prodRes.json();
const p = Array.isArray(prodJson) ? prodJson[0] : prodJson;

if (!p) { console.log('No product returned'); process.exit(0); }

console.log('\n=== Product level ===');
console.log('name:', p.name, '| status:', p.status);
console.log('optionLabel1:', p.optionLabel1, '| optionLabel2:', p.optionLabel2, '| optionLabel3:', p.optionLabel3);
console.log('sizeRangeId:', p.sizeRangeId ?? 'n/a');
console.log('\n=== All productOptions ===');
for (const opt of (p.productOptions ?? [])) {
  const keys = Object.keys(opt).filter(k => opt[k] !== null && opt[k] !== '' && opt[k] !== 0);
  console.log(JSON.stringify(Object.fromEntries(keys.map(k => [k, opt[k]]))));
}

// Now check /Stock for this product
const stockUrl = `https://api.cin7.com/api/v1/Stock?rows=50&productId=${prodRow.cin7_product_id}`;
console.log('\n=== /Stock for this product ===');
console.log('Fetching:', stockUrl);
const stockRes = await fetch(stockUrl, { headers: { Authorization: authHeader } });
const stockData = await stockRes.json();

if (Array.isArray(stockData) && stockData.length > 0) {
  console.log('Keys in stock record:', Object.keys(stockData[0]).join(', '));
  console.log(`${stockData.length} records:`);
  for (const s of stockData) {
    // Show only non-null/non-zero fields
    const keys = Object.keys(s).filter(k => s[k] !== null && s[k] !== '' && s[k] !== 0);
    console.log(JSON.stringify(Object.fromEntries(keys.map(k => [k, s[k]]))));
  }
} else {
  console.log('No stock records or error:', JSON.stringify(stockData).slice(0, 200));
}
