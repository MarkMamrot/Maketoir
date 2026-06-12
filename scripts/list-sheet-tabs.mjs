import 'dotenv/config';
import { google } from 'googleapis';

const spreadsheetId = process.argv[2];
if (!spreadsheetId) throw new Error('Usage: node scripts/list-sheet-tabs.mjs <spreadsheetId>');

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

const meta = await sheets.spreadsheets.get({
  spreadsheetId,
  fields: 'properties.title,sheets.properties.title,sheets.properties.gridProperties',
});

const titles = (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean);
console.log(JSON.stringify({
  spreadsheetTitle: meta.data.properties?.title,
  sheetCount: titles.length,
  sheets: titles,
}, null, 2));
