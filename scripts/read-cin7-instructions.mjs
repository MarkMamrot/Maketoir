import 'dotenv/config';
import { google } from 'googleapis';

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
const SPREADSHEET_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

// 1. APIInstructions sheet
const instrRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: 'APIInstructions!A:D',
});
const rows = instrRes.data.values || [];
const cin7Row = rows.find(r => r[0] === 'cin7');
if (cin7Row) {
  console.log('=== CIN7 API INSTRUCTIONS SUMMARY ===');
  console.log(cin7Row[1] || '(empty)');
  console.log('\n=== CIN7 ENDPOINTS JSON ===');
  console.log(cin7Row[3] || '(empty)');
}

// 2. Schema_cin7 sheet
const schemaRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: 'Schema_cin7!A:C',
});
const schemaRows = schemaRes.data.values || [];
console.log('\n=== Schema_cin7 (first 100 rows) ===');
schemaRows.slice(0, 100).forEach(r => console.log(r.join(' | ')));
