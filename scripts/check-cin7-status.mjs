import 'dotenv/config';
import { google } from 'googleapis';
import https from 'https';
import { createDecipheriv } from 'crypto';

// ── Decrypt helper (mirrors src/lib/encryption.ts) ───────────────────────────
function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored; // legacy plain text
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

// ── Google Sheets auth ────────────────────────────────────────────────────────
const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8') : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ── Load decrypted Cin7 creds ─────────────────────────────────────────────────
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
const token = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
console.log(`Auth: account=${accountId}, key=${apiKey ? '(decrypted OK)' : '(EMPTY)'}\n`);

// ── Helper ────────────────────────────────────────────────────────────────────
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

const sleep = ms => new Promise(res => setTimeout(res, ms));

// Fetch full field details of a known-inactive product (id=16526, Marzia Cosmetic Bag)
// We confirmed status="Inactive" in the GET scan — now verify the exact field value
// and see all fields so we know exactly what to PUT back.
console.log('=== Full fields of inactive product id=16526 (Marzia Cosmetic Bag) ===');
const r1 = await fetchJSON('https://api.cin7.com/api/v1/Products?rows=1&page=1&where=id%3D16526');
console.log(`HTTP ${r1.status}`);
const p = Array.isArray(r1.data) ? r1.data[0] : null;
if (p) {
  for (const [k, v] of Object.entries(p)) {
    const display = Array.isArray(v) ? `[array len=${v.length}]` : JSON.stringify(v);
    console.log(`  ${k}: ${display}`);
  }
} else {
  console.log('Not found:', String(r1.data).slice(0, 200));
}
