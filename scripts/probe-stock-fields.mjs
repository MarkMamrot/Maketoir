/**
 * probe-stock-fields.mjs
 * Dumps all field names (and sample values) from Cin7 Omni /Stock response
 * to confirm exact field names for reorder point / reorder qty.
 */
import 'dotenv/config';
import { google } from 'googleapis';
import https from 'https';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8') : null;
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
const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
const token = Buffer.from(`${accountId}:${apiKey}`).toString('base64');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Basic ${token}` } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    }).on('error', reject);
  });
}

console.log('Fetching /Stock?rows=5&page=1 ...\n');
const { status, data } = await fetchJSON('https://api.cin7.com/api/v1/Stock?rows=5&page=1');
console.log(`HTTP ${status}`);

if (!Array.isArray(data) || data.length === 0) {
  console.log('No records returned:', data);
  process.exit(1);
}

// Print all keys with their values from the first record
console.log('\n=== First stock record — all fields ===');
const first = data[0];
for (const [k, v] of Object.entries(first)) {
  console.log(`  ${k}: ${JSON.stringify(v)}`);
}

// Find any record where a reorder-like field is non-zero
console.log('\n=== All unique field names across 5 records ===');
const allKeys = new Set();
data.forEach(s => Object.keys(s).forEach(k => allKeys.add(k)));
console.log([...allKeys].sort().join('\n'));

// Look for any reorder/min-related non-zero values
console.log('\n=== Non-zero reorder/min fields ===');
for (const s of data) {
  for (const [k, v] of Object.entries(s)) {
    if (/reorder|reOrder|minimum|minLevel|minQty|reorderPoint|reOrderPoint/i.test(k)) {
      console.log(`  ${s.branchName} / ${s.code}: ${k} = ${JSON.stringify(v)}`);
    }
  }
}
