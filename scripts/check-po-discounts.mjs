import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

const r = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const token = Buffer.from(`${get('Cin7AccountId')}:${decrypt(get('Cin7ApiKey'))}`).toString('base64');

// Fetch PO by reference
const res = await fetch(`https://api.cin7.com/api/v1/PurchaseOrders?rows=10&page=1&where=reference='PO-911860'`, {
  headers: { Authorization: `Basic ${token}` },
});
const data = await res.json();
if (!Array.isArray(data) || data.length === 0) {
  console.log('PO not found. Response:', JSON.stringify(data).slice(0, 500));
  process.exit(1);
}

const order = data[0];
console.log('PO:', order.id, order.reference);
console.log('Order-level discount fields:');
const orderDiscountFields = ['discount', 'discountTotal', 'discountAmount', 'totalDiscount', 'productTotal', 'taxTotal', 'freightTotal', 'total'];
for (const f of orderDiscountFields) {
  if (order[f] != null) console.log(`  ${f}:`, order[f]);
}

const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
console.log(`\nLine items (${lines.length} total), first 5:`);
const lineFields = ['code', 'name', 'qty', 'unitPrice', 'discount', 'discountAmount', 'discountPercent',
  'discountPercentage', 'lineDiscount', 'total', 'lineTotal', 'nettTotal', 'netTotal', 'amount'];

for (const line of lines.slice(0, 5)) {
  const row = {};
  for (const f of lineFields) {
    if (line[f] != null) row[f] = line[f];
  }
  console.log(JSON.stringify(row));
}

// Also print ALL keys on first line item to catch anything we're missing
if (lines.length > 0) {
  console.log('\nAll keys on first line item:', Object.keys(lines[0]).join(', '));
  console.log('Full first line item:', JSON.stringify(lines[0], null, 2));
}
