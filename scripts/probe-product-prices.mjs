import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

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

const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8') : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({ credentials, keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });

const r = await sheets.spreadsheets.values.get({ spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps', range: 'Connections!A1:Z2' });
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const token = Buffer.from(`${get('Cin7AccountId')}:${decrypt(get('Cin7ApiKey'))}`).toString('base64');

const res = await fetch('https://api.cin7.com/api/v1/Products?rows=3&page=1', { headers: { Authorization: `Basic ${token}` } });
const products = await res.json();
if (!Array.isArray(products) || !products.length) { console.log('No products:', products); process.exit(1); }

const p = products[0];
console.log('Product:', p.name, '| styleCode:', p.styleCode);
const opt = (p.productOptions ?? [])[0];
if (!opt) { console.log('No options'); process.exit(0); }

console.log('\n=== Top-level option fields ===');
const topLevel = Object.entries(opt).filter(([k]) => k !== 'priceColumns').map(([k,v]) => `  ${k}: ${JSON.stringify(v)}`);
console.log(topLevel.join('\n'));

console.log('\n=== priceColumns fields ===');
if (opt.priceColumns) {
  Object.entries(opt.priceColumns).forEach(([k,v]) => console.log(`  ${k}: ${JSON.stringify(v)}`));
} else {
  console.log('  (no priceColumns)');
}
