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
const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
const token = Buffer.from(`${accountId}:${apiKey}`).toString('base64');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Basic ${token}` } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: body });
        }
      });
    }).on('error', reject);
  });
}

const urls = [
  'https://api.cin7.com/api/v1/Branches?rows=5&page=1',
  'https://api.cin7.com/api/v1/Branches?rows=250&page=1',
  'https://api.cin7.com/api/v1/Branch?rows=5&page=1',
];

console.log(`Auth account=${accountId} decryptedKey=${apiKey ? 'yes' : 'no'}`);
for (const url of urls) {
  const res = await fetchJSON(url);
  console.log('\nURL:', url);
  console.log('HTTP:', res.status);
  if (Array.isArray(res.data)) {
    console.log('Shape: top-level array');
    console.log('Count:', res.data.length);
    if (res.data[0]) {
      console.log('Keys[0]:', Object.keys(res.data[0]).join(', '));
      console.log('Sample[0]:', JSON.stringify(res.data[0]).slice(0, 400));
    }
  } else if (res.data && typeof res.data === 'object') {
    console.log('Shape: object keys =>', Object.keys(res.data).join(', '));
    const candidates = ['data', 'Branches', 'branches', 'records', 'items'];
    for (const key of candidates) {
      if (Array.isArray(res.data[key])) {
        console.log(`Nested array at ${key}:`, res.data[key].length);
      }
    }
    console.log('Snippet:', JSON.stringify(res.data).slice(0, 400));
  } else {
    console.log('Non-JSON body snippet:', String(res.raw).slice(0, 400));
  }
}
