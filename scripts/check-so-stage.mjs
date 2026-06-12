import 'dotenv/config';
import { createDecipheriv } from 'crypto';
import { google } from 'googleapis';

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

const auth = new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });
const conn = await sheets.spreadsheets.values.get({ spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps', range: 'Connections!A1:Z2' });
const [hdrs, vals] = conn.data.values;
const get = (k) => vals[hdrs.indexOf(k)] ?? '';
const token = Buffer.from(`${get('Cin7AccountId')}:${decrypt(get('Cin7ApiKey'))}`).toString('base64');

const seen = new Set();
for (let page = 1; page <= 5; page++) {
  const res = await fetch(`https://api.cin7.com/api/v1/SalesOrders?rows=250&page=${page}`, { headers: { Authorization: `Basic ${token}` } });
  const orders = await res.json();
  if (!Array.isArray(orders) || orders.length === 0) break;
  for (const o of orders) {
    const key = (o.status ?? 'null') + '|' + (o.stage ?? 'null');
    if (!seen.has(key)) {
      seen.add(key);
      console.log('status:', JSON.stringify(o.status), ' stage:', JSON.stringify(o.stage));
    }
  }
}
process.exit(0);
