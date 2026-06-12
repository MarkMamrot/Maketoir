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
const auth = new google.auth.GoogleAuth({
  credentials: credRaw ? JSON.parse(credRaw) : undefined,
  keyFile: credRaw ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const token = Buffer.from(get('Cin7AccountId') + ':' + decrypt(get('Cin7ApiKey'))).toString('base64');
const BASE = 'https://api.cin7.com/api/v1';

// GET current state
const g = await fetch(`${BASE}/Products?rows=1&where=styleCode='MAGW-645'&fields=id,optionLabel1,optionLabel2,optionLabel3`, {
  headers: { Authorization: `Basic ${token}` },
});
const [prod] = await g.json();
console.log('BEFORE:', JSON.stringify({ id: prod.id, optionLabel1: prod.optionLabel1, optionLabel2: prod.optionLabel2, optionLabel3: prod.optionLabel3 }));

// PUT optionLabel3 = WEBREADY
const p = await fetch(`${BASE}/Products`, {
  method: 'PUT',
  headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ id: prod.id, optionLabel3: 'WEBREADY' }]),
});
console.log('PUT HTTP', p.status, JSON.stringify(await p.json()));
await new Promise(r => setTimeout(r, 2000));

// Verify
const g2 = await fetch(`${BASE}/Products?rows=1&where=id=${prod.id}&fields=id,optionLabel1,optionLabel2,optionLabel3`, {
  headers: { Authorization: `Basic ${token}` },
});
const [prod2] = await g2.json();
console.log('AFTER:', JSON.stringify({ optionLabel1: prod2.optionLabel1, optionLabel2: prod2.optionLabel2, optionLabel3: prod2.optionLabel3 }));
