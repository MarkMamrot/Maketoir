import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createDecipheriv } from 'crypto';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const bid = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const [[row]] = await db.execute('SELECT cin7_api_key, cin7_account_id FROM connections WHERE business_id=?', [bid]);
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const parts = row.cin7_api_key.split(':');
const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
dec.setAuthTag(Buffer.from(parts[1], 'hex'));
const apiKey = dec.update(Buffer.from(parts[2], 'hex')) + dec.final('utf8');
const auth = 'Basic ' + Buffer.from(`${row.cin7_account_id}:${apiKey}`).toString('base64');
await db.end();

// Fetch product 12823 directly
const r = await fetch('https://api.cin7.com/api/v1/Products?rows=1&page=1&id=12823', {
  headers: { Authorization: auth }
});
const data = await r.json();
const products = Array.isArray(data) ? data : (data.data ?? []);
if (!products.length) { console.log('No product found'); process.exit(0); }

const p = products[0];
console.log('Product:', p.id, p.name, '| status:', p.status, '| styleCode:', p.styleCode);
console.log('productOptions count:', p.productOptions?.length ?? 0);
console.log('\nAll keys on product:', Object.keys(p).join(', '));
console.log('\nproductOptions:');
for (const opt of (p.productOptions ?? [])) {
  console.log(' ', JSON.stringify({ id: opt.id, code: opt.code, option1: opt.option1, option2: opt.option2, status: opt.status }));
}

// Check for any size grid related keys
const sizeKeys = Object.keys(p).filter(k => k.toLowerCase().includes('size') || k.toLowerCase().includes('grid') || k.toLowerCase().includes('range'));
if (sizeKeys.length) console.log('\nSize-related keys:', sizeKeys);
