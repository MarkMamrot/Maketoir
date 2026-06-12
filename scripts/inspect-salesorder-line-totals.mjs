import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be set (64 hex chars)');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

function asNum(v) {
  const n = Number.parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

const inventorySheetId = process.argv[2] || '1lKZAnxV1Mmdv-VGQOR5zYBkCb9OzLtkkTgUnSuBRVZo';
const targetReference = process.argv[3] || 'CHAR5585-5';
const targetOrderId = process.argv[4] || '837839';
const credentialsSheetId = process.argv[5] || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

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

const conn = await sheets.spreadsheets.values.get({
  spreadsheetId: credentialsSheetId,
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = conn.data.values || [];
if (!hdrs || !vals) throw new Error('Could not read Connections!A1:Z2 from provided sheet');

const get = (k) => vals[hdrs.indexOf(k)] ?? '';
const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
if (!accountId || !apiKey) throw new Error('Missing Cin7 credentials in Connections tab');

const token = Buffer.from(`${accountId}:${apiKey}`).toString('base64');

async function cin7Get(path) {
  const res = await fetch(`https://api.cin7.com/api/v1${path}`, {
    headers: { Authorization: `Basic ${token}` },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const byId = await cin7Get(`/SalesOrders/${encodeURIComponent(targetOrderId)}`);
let order = byId.status === 200 ? byId.body : null;

if (!order) {
  const where = encodeURIComponent(`reference='${targetReference}'`);
  const byRef = await cin7Get(`/SalesOrders?rows=50&page=1&where=${where}`);
  if (byRef.status === 200 && Array.isArray(byRef.body) && byRef.body.length > 0) {
    order = byRef.body.find(o => String(o.reference || '') === targetReference) || byRef.body[0];
  }
}

if (!order) {
  console.log('Could not find target order');
  console.log('By ID status:', byId.status);
  if (typeof byId.body === 'string') console.log(byId.body.slice(0, 500));
  process.exit(1);
}

console.log('Order found:');
console.log({
  id: order.id,
  reference: order.reference,
  invoiceDate: order.invoiceDate,
  branchId: order.branchId,
  memberId: order.memberId,
  lineCount: Array.isArray(order.lineItems) ? order.lineItems.length : 0,
});

const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
if (lines.length === 0) {
  console.log('No lineItems present on order payload.');
  process.exit(0);
}

const candidateFields = [
  'qty', 'unitPrice', 'discount', 'discountType', 'lineTotal', 'total', 'netTotal', 'subTotal', 'subtotal',
  'price', 'lineAmount', 'totalExTax', 'totalIncTax', 'tax', 'taxAmount', 'discountAmount', 'discountValue',
];

console.log('\nLine-level diagnostics:');
for (const line of lines) {
  const row = {
    productOptionId: line.productOptionId,
    code: line.code,
    name: line.name,
  };
  for (const f of candidateFields) {
    if (line[f] != null) row[f] = line[f];
  }

  const qty = asNum(line.qty) ?? 0;
  const price = asNum(line.unitPrice) ?? 0;
  const discount = asNum(line.discount) ?? 0;
  const computedPercent = qty * price * (1 - discount / 100);
  const computedAmount = qty * price - discount;

  row.__computed_percent_formula = Number(computedPercent.toFixed(4));
  row.__computed_amount_formula = Number(computedAmount.toFixed(4));

  console.log(JSON.stringify(row));
}

console.log('\nTop-level order keys sample:');
console.log(Object.keys(order).slice(0, 80));
