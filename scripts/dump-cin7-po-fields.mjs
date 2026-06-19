/**
 * Dumps the top-level field names of the first Cin7 PO so we can identify
 * which field holds the supplier name/id.
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

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
});

const [rows] = await pool.execute(
  'SELECT cin7_account_id, cin7_api_key FROM connections LIMIT 5',
);

let creds = null;
for (const r of rows) {
  if (r.cin7_account_id && r.cin7_api_key) {
    creds = { accountId: r.cin7_account_id, apiKey: decrypt(r.cin7_api_key) };
    break;
  }
}

await pool.end();

if (!creds) { console.error('No Cin7 credentials found in connections table'); process.exit(1); }

const auth = `Basic ${Buffer.from(`${creds.accountId}:${creds.apiKey}`).toString('base64')}`;
const res = await fetch('https://api.cin7.com/api/v1/PurchaseOrders?rows=1&page=1', {
  headers: { Authorization: auth },
});
const data = await res.json();

if (!Array.isArray(data) || data.length === 0) {
  console.log('Response:', JSON.stringify(data).slice(0, 500));
  process.exit(0);
}

const po = data[0];
console.log('=== Top-level fields of Cin7 PO ===');
for (const [k, v] of Object.entries(po)) {
  if (k === 'lineItems') continue;
  console.log(`  ${k}: ${JSON.stringify(v)}`);
}
