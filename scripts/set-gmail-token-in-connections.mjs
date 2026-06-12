import 'dotenv/config';
import { google } from 'googleapis';
import { createCipheriv, randomBytes } from 'crypto';

function getAuth() {
  const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
    ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
    : null;
  const credentials = credRaw ? JSON.parse(credRaw) : undefined;

  return new google.auth.GoogleAuth({
    credentials,
    keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function columnLetter(index1Based) {
  let n = index1Based;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function encryptIfPossible(value) {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!value) return value;
  if (!keyHex || keyHex.length !== 64) return value;

  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

const DB_ID = process.argv[2] || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const tokenArg = process.argv[3];
const token = (tokenArg || process.env.GOOGLE_GMAIL_REFRESH_TOKEN || '').trim();

if (!token) {
  console.error('ERROR: No token provided. Pass as arg #2 or set GOOGLE_GMAIL_REFRESH_TOKEN in .env');
  process.exit(1);
}

const auth = getAuth();
const sheets = google.sheets({ version: 'v4', auth });

const readRes = await sheets.spreadsheets.values.get({
  spreadsheetId: DB_ID,
  range: 'Connections!A1:ZZ2',
});

const rows = readRes.data.values ?? [];
if (rows.length === 0) {
  console.error('ERROR: Connections sheet is empty or missing headers.');
  process.exit(1);
}

const headers = rows[0];
const values = rows[1] ?? [];

let idx = headers.indexOf('GmailRefreshToken');
if (idx < 0) {
  headers.push('GmailRefreshToken');
  values.push('');
  idx = headers.length - 1;
}

const col = columnLetter(idx + 1);
const storedValue = encryptIfPossible(token);

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: DB_ID,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: 'Connections!A1', values: [headers] },
      { range: 'Connections!A2', values: [values] },
      { range: `Connections!${col}2`, values: [[storedValue]] },
    ],
  },
});

console.log(`Done. GmailRefreshToken written to Connections (${col}2) for DB ${DB_ID}.`);
console.log(`Stored format: ${storedValue.includes(':') ? 'encrypted' : 'plain text'} (token value hidden).`);
