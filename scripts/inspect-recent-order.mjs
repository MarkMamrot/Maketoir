import 'dotenv/config';
import { google } from 'googleapis';
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

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const conn = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = conn.data.values;
const get = (k) => vals[hdrs.indexOf(k)] ?? '';
const token = Buffer.from(`${get('Cin7AccountId')}:${decrypt(get('Cin7ApiKey'))}`).toString('base64');

// Fetch recent orders and find one with real priced products
const res = await fetch('https://api.cin7.com/api/v1/SalesOrders?rows=50&page=1', {
  headers: { Authorization: `Basic ${token}` },
});
const orders = await res.json();
if (!Array.isArray(orders)) { console.log('Error:', orders); process.exit(1); }

// Find a POS or Shopify order that has a line item with unitPrice > 5 (a real product)
const order = orders.find(o => {
  const lines = Array.isArray(o.lineItems) ? o.lineItems : [];
  return lines.some(l => Number(l.unitPrice) > 5 && !String(l.code ?? '').startsWith('Wrap') && !String(l.code ?? '').startsWith('WPAP'));
}) ?? orders[0];

console.log('Order:', order.id, order.reference);
console.log('Source:', order.source);
console.log('invoiceDate:', order.invoiceDate);

const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
const candidateFields = [
  'qty', 'unitPrice', 'discount', 'discountType',
  'lineTotal', 'total', 'netTotal', 'nettTotal',
  'subTotal', 'subtotal', 'price', 'lineAmount',
  'totalExTax', 'totalIncTax', 'tax', 'taxAmount', 'taxRate',
];

console.log('\nLine items (up to 5):');
for (const line of lines.slice(0, 5)) {
  const row = { code: line.code, name: line.name?.slice(0, 30) };
  for (const f of candidateFields) {
    if (line[f] != null) row[f] = line[f];
  }
  // Computed values for comparison
  const qty = Number(line.qty) || 0;
  const price = Number(line.unitPrice) || 0;
  const disc = Number(line.discount) || 0;
  row.__gross = Number((qty * price).toFixed(4));
  row.__grossMinusDisc = Number((qty * price - disc).toFixed(4));
  console.log(JSON.stringify(row));
}

console.log('\nOrder-level keys:', Object.keys(order).join(', '));
console.log('Order-level total fields:', {
  total: order.total,
  productTotal: order.productTotal,
  discountTotal: order.discountTotal,
  taxStatus: order.taxStatus,
  taxRate: order.taxRate,
  totalExTax: order.totalExTax,
  totalIncTax: order.totalIncTax,
  taxTotal: order.taxTotal,
  amountDue: order.amountDue,
  subTotal: order.subTotal,
});
