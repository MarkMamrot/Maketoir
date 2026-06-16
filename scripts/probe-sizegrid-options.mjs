import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const [[row]] = await db.execute('SELECT cin7_api_key, cin7_account_id FROM connections WHERE business_id=?', ['1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps']);
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const parts = row.cin7_api_key.split(':');
const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
dec.setAuthTag(Buffer.from(parts[1], 'hex'));
const apiKey = dec.update(Buffer.from(parts[2], 'hex')) + dec.final('utf8');
const auth = 'Basic ' + Buffer.from(row.cin7_account_id + ':' + apiKey).toString('base64');
await db.end();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. Full raw option fields for product 12823
console.log('=== /Products id=12823 — raw productOptions ===');
const r1 = await fetch('https://api.cin7.com/api/v1/Products?rows=1&page=1&where=id=12823', { headers: { Authorization: auth } });
const d1 = await r1.json();
const p = Array.isArray(d1) ? d1[0] : d1;
console.log('Product fields:', Object.keys(p).join(', '));
const opts = p.productOptions || [];
console.log('productOptions count:', opts.length);
if (opts.length > 0) {
  console.log('All fields on first option:', Object.keys(opts[0]).join(', '));
  for (const o of opts) {
    const { id, code, option1, option2, option3, productId, productOptionId, ...rest } = o;
    console.log(`  id=${id} productOptionId=${productOptionId} productId=${productId} code=${code} opt1=${option1} extra=${JSON.stringify(rest).slice(0,100)}`);
  }
}

await sleep(1200);

// 2. Stock records for productOptionId=12892
console.log('\n=== /Stock for productOptionId around 12892 ===');
const r2 = await fetch('https://api.cin7.com/api/v1/Stock?rows=20&page=1&where=productId=12823', { headers: { Authorization: auth } });
const d2 = await r2.json();
const stocks = Array.isArray(d2) ? d2 : (d2.data ?? []);
console.log('Stock records returned:', stocks.length);
if (stocks.length > 0) {
  console.log('Stock fields:', Object.keys(stocks[0]).join(', '));
  for (const s of stocks) console.log(`  productOptionId=${s.productOptionId} code=${s.code} branchId=${s.branchId} soh=${s.stockOnHand}`);
}
