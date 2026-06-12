import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  // If not in iv:authTag:ciphertext format, treat as plaintext
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

// Accept style code from CLI arg, default to GME109
const styleCode = process.argv[2] || 'GME109';
const url = `https://api.cin7.com/api/v1/Products?rows=10&page=1&where=styleCode%3D'${encodeURIComponent(styleCode)}'`;
console.log('Querying:', url);

const res = await fetch(url, { headers: { Authorization: `Basic ${token}` } });
const body = await res.json();
console.log('HTTP', res.status);
if (Array.isArray(body)) {
  if (body.length === 0) { console.log('No products found.'); process.exit(0); }
  const product = body[0];
  console.log('Current → id:', product.id, 'status:', product.status, 'modified:', product.modifiedDate);
  // Try different PUT strategies
for (const [label, payload] of [
  ['minimal id+status Inactive',    [{ id: product.id, status: 'Inactive' }]],
  ['minimal id+status Archived',    [{ id: product.id, status: 'Archived' }]],
  ['full object status Inactive',   [{ ...product, status: 'Inactive' }]],
]) {
  const pr = await fetch('https://api.cin7.com/api/v1/Products', {
    method: 'PUT',
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const pb = await pr.json();
  console.log(`\n[${label}] PUT HTTP ${pr.status}:`, JSON.stringify(pb));
  await new Promise(r => setTimeout(r, 1500));
  const vr = await fetch(url, { headers: { Authorization: `Basic ${token}` } });
  const [vp] = await vr.json();
  console.log(`  → status: ${vp?.status}  modified: ${vp?.modifiedDate}`);
  await new Promise(r => setTimeout(r, 1200));
}
} else {
  console.log(JSON.stringify(body, null, 2));
}
