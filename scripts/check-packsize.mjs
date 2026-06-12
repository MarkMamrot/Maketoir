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
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

const r = await sheetsApi.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const hdrs = r.data.values[0];
const vals = r.data.values[1];
const get = (n) => { const i = hdrs.indexOf(n); return i >= 0 ? vals[i] : ''; };

const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
const authHeader = 'Basic ' + Buffer.from(accountId + ':' + apiKey).toString('base64');

const url = `https://api.cin7.com/api/v1/Products?rows=5&where=styleCode='MT-ULKook'`;
const res = await fetch(url, { headers: { Authorization: authHeader } });
const data = await res.json();
const prod = Array.isArray(data) ? data[0] : data;
console.log(JSON.stringify(prod, null, 2).slice(0, 5000));
