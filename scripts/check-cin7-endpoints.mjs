import 'dotenv/config';
import { google } from 'googleapis';
import https from 'https';

// ── Auth (same pattern as read-cin7-instructions.mjs) ────────────────────────
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

// ── Load Cin7 credentials from Monsterthreads DB ──────────────────────────────
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const accountId = get('Cin7AccountId');
const apiKeyRaw  = get('Cin7ApiKey'); // stored encrypted — we'll use it raw to get a 401 vs 404 signal

// Even if decryption fails we'll see 401 for real endpoints and 404 for fake ones
const token = Buffer.from(`${accountId}:${apiKeyRaw}`).toString('base64');

// ── Endpoints to probe ────────────────────────────────────────────────────────
const endpoints = [
  '/Products', '/ProductsList', '/Contacts',
  '/SalesOrders', '/SalesOrderLines', '/SalesInvoices',
  '/PurchaseOrders', '/PurchaseOrderLines',
  '/ProductAvailability', '/ProductAvailabilities',
  '/Inventory', '/StockAdjustments', '/Branches',
];

function probe(ep) {
  return new Promise(resolve => {
    const url = `https://api.cin7.com/api/v1${ep}?rows=1&page=1`;
    https.get(url, { headers: { Authorization: `Basic ${token}` } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ ep, status: res.statusCode, body: body.slice(0, 120) }));
    }).on('error', e => resolve({ ep, status: 'ERR', body: e.message }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('Probing Cin7 Omni endpoints (1 req/sec)...\n');
for (const ep of endpoints) {
  const { status, body } = await probe(ep);
  const tag = status === 200 ? '✅' : status === 401 || status === 403 ? '🔑' : status === 404 ? '❌' : '⚠️';
  console.log(`${tag} ${status}  ${ep}${status !== 200 ? '  →  ' + body.replace(/\n/g, ' ') : ''}`);
  await sleep(1100);
}
console.log('\nKey: ✅ exists  🔑 exists (auth issue)  ❌ not found  ⚠️ other error');
