/**
 * setup-inventory-system.mjs
 *
 * Creates a new "Inventory System - <BusinessName>" Google Sheet in the
 * business Drive folder, copies the 4 inventory-related tabs from the main
 * business database, then writes the new spreadsheet's ID into the
 * Connections sheet so every API route can find it.
 *
 * Tabs migrated:  Products | Sales | APIInstructions | Schema_cin7
 * New column:     InventorySystemId  (appended to Connections row 1 + row 2)
 *
 * Usage:
 *   node scripts/setup-inventory-system.mjs [DATABASE_SPREADSHEET_ID]
 *
 * If no arg is supplied, defaults to the Monsterthreads DB.
 */

import 'dotenv/config';
import { google } from 'googleapis';

// ── Auth ──────────────────────────────────────────────────────────────────────
const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
  ],
});
const sh = google.sheets({ version: 'v4', auth });
const dr = google.drive({ version: 'v3', auth });

// ── Config ────────────────────────────────────────────────────────────────────
const DB_ID = process.argv[2] || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const TABS_TO_MIGRATE = ['Products', 'Sales', 'APIInstructions', 'Schema_cin7'];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function readSheet(spreadsheetId, range) {
  const res = await sh.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values ?? [];
}

async function ensureTab(spreadsheetId, title) {
  try {
    await sh.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  } catch (e) {
    // Already exists — that's fine
    if (!e.message?.includes('already exists')) throw e;
  }
}

async function writeRows(spreadsheetId, sheetName, rows) {
  if (!rows.length) return;
  // Clear first, then write in batches of 5000 rows to stay under the 10MB write limit
  await sh.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:ZZ` });
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await sh.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${i + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows.slice(i, i + BATCH) },
    });
    console.log(`  wrote rows ${i + 1}–${Math.min(i + BATCH, rows.length)} of ${rows.length}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\nSource database: ${DB_ID}`);

// 1. Read Connections — check for existing InventorySystemId
const connData = await readSheet(DB_ID, 'Connections!A1:ZZ2');
if (!connData.length) {
  console.error('ERROR: Connections sheet is empty or missing.');
  process.exit(1);
}
const connHeaders = connData[0];
const connVals    = connData[1] ?? [];

const existingIdx = connHeaders.indexOf('InventorySystemId');
if (existingIdx >= 0 && connVals[existingIdx]) {
  console.log(`\nInventory System already set up: ${connVals[existingIdx]}`);
  console.log('Run this script again only if you want to recreate it.');
  process.exit(0);
}

// 2. Get business name (for spreadsheet title)
let businessName = 'Business';
try {
  const biRows = await readSheet(DB_ID, 'BusinessInfo!A1:B2');
  if (biRows.length >= 2) businessName = biRows[1][1] || 'Business';
} catch { /* use default */ }
console.log(`Business name: ${businessName}`);

// 3. Get Drive folder ID from Config tab
let folderId = null;
try {
  const cfgRows = await readSheet(DB_ID, 'Config!A:B');
  const row = cfgRows.find(r => r[0] === 'FolderID');
  if (row) folderId = row[1];
} catch { /* no Config tab */ }
console.log(`Drive folder ID: ${folderId ?? '(none — sheet will be created at root)'}`);

// 4. Create the new Inventory System spreadsheet
const fileMetadata = {
  name: `Inventory System - ${businessName}`,
  mimeType: 'application/vnd.google-apps.spreadsheet',
};
if (folderId) fileMetadata.parents = [folderId];

console.log(`\nCreating spreadsheet "Inventory System - ${businessName}"...`);
const createRes = await dr.files.create({
  requestBody: fileMetadata,
  supportsAllDrives: true,
  fields: 'id',
});
const invSystemId = createRes.data.id;
if (!invSystemId) { console.error('Failed to create spreadsheet.'); process.exit(1); }
console.log(`Created: https://docs.google.com/spreadsheets/d/${invSystemId}`);

// 5. Copy each tab
for (const tab of TABS_TO_MIGRATE) {
  console.log(`\nCopying tab "${tab}"...`);
  let rows;
  try {
    rows = await readSheet(DB_ID, tab);
  } catch (e) {
    console.log(`  Skipping — tab not found or unreadable: ${e.message}`);
    continue;
  }
  if (!rows.length) {
    console.log(`  Skipping — tab is empty.`);
    continue;
  }
  await ensureTab(invSystemId, tab);
  await writeRows(invSystemId, tab, rows);
  console.log(`  ✓ Copied ${rows.length} rows`);
}

// Delete the default "Sheet1" tab that Google creates automatically
try {
  const meta = await sh.spreadsheets.get({ spreadsheetId: invSystemId, fields: 'sheets.properties' });
  const sheet1 = meta.data.sheets?.find(s => s.properties?.title === 'Sheet1');
  if (sheet1?.properties?.sheetId != null) {
    await sh.spreadsheets.batchUpdate({
      spreadsheetId: invSystemId,
      requestBody: { requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }] },
    });
    console.log('\nRemoved default "Sheet1" tab.');
  }
} catch { /* ignore */ }

// 6. Write InventorySystemId into Connections
const newColLetter = columnLetter(connHeaders.length + 1); // e.g. 'J' for column 10
console.log(`\nWriting InventorySystemId to Connections column ${newColLetter}...`);
await sh.spreadsheets.values.batchUpdate({
  spreadsheetId: DB_ID,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `Connections!${newColLetter}1`, values: [['InventorySystemId']] },
      { range: `Connections!${newColLetter}2`, values: [[invSystemId]] },
    ],
  },
});
console.log('✓ InventorySystemId saved to Connections sheet.');

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Inventory System created successfully!

   Spreadsheet ID : ${invSystemId}
   URL            : https://docs.google.com/spreadsheets/d/${invSystemId}

   Tabs migrated  : ${TABS_TO_MIGRATE.join(', ')}
   Connections    : InventorySystemId column added

   API routes will now automatically read/write inventory
   data to this new spreadsheet.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// ── Utility ───────────────────────────────────────────────────────────────────
function columnLetter(n) {
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
