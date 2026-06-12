/**
 * One-off script: Create the Monsterthreads business subfolder in Google Drive,
 * move the existing Monsterthreads database into it, store the folder ID in the
 * database's Config sheet, and backfill the AllUsers Businesses tab with the folder ID.
 *
 * Run with: node scripts/setup-monsterthreads-folder.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const USER_DB_FOLDER_ID  = '1hSCkMJ0Y5XLV1d46zs4gGjnTTZo_h_jG'; // User Databases subfolder
const ALL_USERS_ID       = '11sXbhgWolrEbKGJKPba4V6rpZQm5vjs2dRQeleL6_Uo';
const MONSTERS_DB_ID     = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const BUSINESS_NAME      = 'Monsterthreads';

function buildAuth() {
  const credsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsFile) throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(credsFile, 'utf8')),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

async function main() {
  const auth   = buildAuth();
  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // ── 1. Create the Monsterthreads subfolder ──────────────────────────────────
  console.log(`\nCreating "${BUSINESS_NAME}" folder inside User Databases...`);
  const folderRes = await drive.files.create({
    requestBody: {
      name: BUSINESS_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [USER_DB_FOLDER_ID],
    },
    supportsAllDrives: true,
    fields: 'id, name',
  });
  const folderId = folderRes.data.id;
  console.log(`  ✅ Folder created: ${folderId}`);

  // ── 2. Move the Monsterthreads DB into the new subfolder ────────────────────
  console.log(`\nMoving database ${MONSTERS_DB_ID} into the subfolder...`);
  // Get current parents first so we can remove them
  const fileInfo = await drive.files.get({
    fileId: MONSTERS_DB_ID,
    fields: 'parents',
    supportsAllDrives: true,
  });
  const oldParents = (fileInfo.data.parents || []).join(',');
  await drive.files.update({
    fileId: MONSTERS_DB_ID,
    addParents: folderId,
    removeParents: oldParents || undefined,
    supportsAllDrives: true,
    fields: 'id',
  });
  console.log(`  ✅ Database moved into folder.`);

  // ── 3. Write FolderID to Config tab in the Monsterthreads DB ───────────────
  console.log(`\nWriting FolderID to Config tab in database...`);
  // Ensure Config tab exists
  const dbMeta = await sheets.spreadsheets.get({ spreadsheetId: MONSTERS_DB_ID });
  const existingTabs = dbMeta.data.sheets.map(s => s.properties.title);
  if (!existingTabs.includes('Config')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: MONSTERS_DB_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Config' } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: MONSTERS_DB_ID,
      range: 'Config!A1:B1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Key', 'Value']] },
    });
    console.log('  Config tab created.');
  }

  // Check if FolderID row already exists
  const configData = await sheets.spreadsheets.values.get({
    spreadsheetId: MONSTERS_DB_ID,
    range: 'Config!A:B',
  });
  const rows = configData.data.values || [];
  const folderRow = rows.findIndex((r, i) => i > 0 && r[0] === 'FolderID');

  if (folderRow > -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: MONSTERS_DB_ID,
      range: `Config!B${folderRow + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[folderId]] },
    });
    console.log('  ✅ FolderID updated in Config.');
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: MONSTERS_DB_ID,
      range: 'Config!A:B',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [['FolderID', folderId]] },
    });
    console.log('  ✅ FolderID written to Config.');
  }

  // ── 4. Add Folder ID column to Businesses tab header if missing ─────────────
  console.log(`\nUpdating AllUsers Businesses tab headers...`);
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: ALL_USERS_ID,
    range: 'Businesses!1:1',
  });
  const headers = headerRes.data.values?.[0] || [];
  if (!headers.includes('Folder ID')) {
    const nextCol = String.fromCharCode(65 + headers.length); // A=0, so length gives next col letter
    await sheets.spreadsheets.values.update({
      spreadsheetId: ALL_USERS_ID,
      range: `Businesses!${nextCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Folder ID']] },
    });
    console.log(`  ✅ "Folder ID" column added at column ${nextCol}.`);
  } else {
    console.log('  ℹ️  "Folder ID" column already exists.');
  }

  // ── 5. Write the folder ID to the Monsterthreads row in Businesses tab ──────
  console.log(`\nBackfilling Folder ID for ${BUSINESS_NAME} in Businesses tab...`);
  const bizRes = await sheets.spreadsheets.values.get({
    spreadsheetId: ALL_USERS_ID,
    range: 'Businesses!A:F',
  });
  const bizRows = bizRes.data.values || [];
  const headerRow = bizRows[0] || [];
  const folderColIdx = headerRow.indexOf('Folder ID');
  const monsterRow = bizRows.findIndex((r, i) => i > 0 && r[0] === BUSINESS_NAME);

  if (monsterRow > -1 && folderColIdx > -1) {
    const col = String.fromCharCode(65 + folderColIdx);
    const sheetRowNum = monsterRow + 1; // 1-indexed
    await sheets.spreadsheets.values.update({
      spreadsheetId: ALL_USERS_ID,
      range: `Businesses!${col}${sheetRowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[folderId]] },
    });
    console.log(`  ✅ Folder ID written to Businesses row ${sheetRowNum}.`);
  } else {
    console.log(`  ⚠️  Could not find "${BUSINESS_NAME}" row or "Folder ID" column. Write manually.`);
    console.log(`      Folder ID: ${folderId}`);
  }

  console.log('\n✅ Done!');
  console.log(`   Business folder: https://drive.google.com/drive/folders/${folderId}`);
  console.log(`   Folder ID: ${folderId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
