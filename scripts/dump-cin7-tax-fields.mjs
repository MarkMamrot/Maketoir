/**
 * Dumps tax-related fields from a sample Cin7 PO and SO.
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

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
});
const [rows] = await conn.execute('SELECT cin7_account_id, cin7_api_key FROM connections LIMIT 5');
await conn.end();

let auth = null;
for (const r of rows) {
  if (r.cin7_account_id && r.cin7_api_key) {
    auth = `Basic ${Buffer.from(`${r.cin7_account_id}:${decrypt(r.cin7_api_key)}`).toString('base64')}`;
    break;
  }
}
if (!auth) { console.error('No Cin7 creds'); process.exit(1); }

const TAX_FIELDS = ['taxStatus','taxRate','taxTotal','taxAmount','tax','taxIncluded',
  'productTotal','freightTotal','surcharge','discountTotal','total',
  'currencyCode','currencyRate'];
const LINE_TAX_FIELDS = ['taxRate','taxAmount','tax','taxTotal','unitPrice','lineTotal',
  'total','qty','discount','discountType'];

async function fetchOne(endpoint, label) {
  const res = await fetch(`https://api.cin7.com/api/v1/${endpoint}?rows=5&page=1`, {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) { console.log(`${label}: no data`); return; }

  // Pick first order that actually has a non-zero taxTotal
  const order = data.find(o => Number(o.taxTotal ?? o.taxAmount ?? o.tax ?? 0) > 0) ?? data[0];

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${label}  id=${order.id}  ref=${order.reference ?? order.id}`);
  console.log(`${'─'.repeat(60)}`);
  console.log('Order-level tax fields:');
  for (const f of TAX_FIELDS) {
    if (order[f] !== undefined) console.log(`  ${f}: ${JSON.stringify(order[f])}`);
  }
  const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
  console.log(`\nLine items (${lines.length}) — tax fields per line:`);
  lines.slice(0, 8).forEach((l, i) => {
    const row = { i, code: l.code, name: l.name?.slice(0,30), qty: l.qty };
    for (const f of LINE_TAX_FIELDS) {
      if (l[f] !== undefined) row[f] = l[f];
    }
    console.log(' ', JSON.stringify(row));
  });
}

await fetchOne('PurchaseOrders', 'PURCHASE ORDER');
await fetchOne('SalesOrders',    'SALES ORDER');
