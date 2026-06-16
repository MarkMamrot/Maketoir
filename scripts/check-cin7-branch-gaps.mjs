import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

const CHECK_CODES = [
  'HB5196W26', 'HB1219W26', 'HB5194W26', 'islatop1-kids', 'islatop2-kids',
  'HB1050S25', 'HB1312S25', 'HB1055S25', 'SS25-3G', 'SS25-3A', 'SS25-6A', 'SS25-6E',
  'SRS-HEJ', 'SRS-SPA', 'SBT-SPA', 'SBT-BIL', 'LG334- FLORET', 'LBH-HEJ',
  'SW-LG257-RAINBOW', 'HE-PB347- DAISY', '7.34007E+12'
];

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

const BUSINESS_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});
const [[conn]] = await db.execute(
  'SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id=? LIMIT 1',
  [BUSINESS_ID],
);
await db.end();

const apiUser = conn.cin7_account_id;
const apiPass = decrypt(conn.cin7_api_key);
const authHeader = 'Basic ' + Buffer.from(`${apiUser}:${apiPass}`).toString('base64');

const data = [];
for (let page = 1; page <= 200; page++) {
  const url = `https://api.cin7.com/api/v1/Stock?rows=250&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  const chunk = await res.json();
  if (!Array.isArray(chunk)) {
    console.log('Unexpected /Stock response:', JSON.stringify(chunk).slice(0, 300));
    process.exit(1);
  }
  if (chunk.length === 0) break;
  data.push(...chunk);
  if (chunk.length < 250) break;
}
console.log(`Loaded ${data.length} stock rows from Cin7`);

const byCode = new Map();
for (const r of data) {
  const code = (r.code ?? '').trim();
  if (!code) continue;
  if (!byCode.has(code)) byCode.set(code, []);
  byCode.get(code).push(r);
}

for (const code of CHECK_CODES) {
  const rows = byCode.get(code) ?? [];
  const positive = rows.filter(r => Number(r.stockOnHand ?? 0) > 0);
  if (rows.length === 0) {
    console.log(`\n${code}: no rows in Cin7 /Stock`);
    continue;
  }
  console.log(`\n${code}: ${rows.length} stock rows, positive rows=${positive.length}`);
  for (const r of positive) {
    console.log(`  branchId=${r.branchId} branchName=${r.branchName} soh=${r.stockOnHand}`);
  }
}
