import 'dotenv/config';
import { google } from 'googleapis';

const targetInventoryId = process.argv[2] || '1lKZAnxV1Mmdv-VGQOR5zYBkCb9OzLtkkTgUnSuBRVZo';

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

const masterId = process.env.MASTER_USERS_SHEET_ID;
if (!masterId) throw new Error('MASTER_USERS_SHEET_ID missing');

const biz = await sheets.spreadsheets.values.get({
  spreadsheetId: masterId,
  range: 'Businesses!A1:F',
});
const rows = biz.data.values || [];
if (rows.length < 2) throw new Error('No business rows in master sheet');

const header = rows[0];
const idxName = header.indexOf('Name');
const idxDb = header.indexOf('Database ID');

const matches = [];
for (const row of rows.slice(1)) {
  const name = row[idxName] || '';
  const dbId = row[idxDb] || '';
  if (!dbId) continue;

  try {
    const cfg = await sheets.spreadsheets.values.get({
      spreadsheetId: dbId,
      range: 'Config!A:B',
    });
    const cfgRows = cfg.data.values || [];
    const inv = cfgRows.find(r => String(r[0] || '').trim().toLowerCase() === 'inventory system');
    const invId = inv?.[1] || '';
    if (invId === targetInventoryId || dbId === targetInventoryId) {
      matches.push({ name, databaseId: dbId, inventorySystemId: invId || dbId });
    }
  } catch {
    // ignore inaccessible/malformed business DBs
  }
}

console.log(JSON.stringify({ targetInventoryId, matchCount: matches.length, matches }, null, 2));
