/**
 * One-off provisioning script for Mark Mamrot.
 * Run with: node scripts/setup-mark-mamrot.mjs
 * Delete after use.
 *
 * What it does:
 *  1. Creates a "User Mark Mamrot" spreadsheet in the shared Drive folder.
 *  2. Adds a "Businesses" tab to the AllUsers master sheet (if not present).
 *  3. Writes Mark's Monsterthreads business row into the Businesses tab.
 *  4. Updates (or inserts) Mark's row in AllUsers Sheet1 with the new UserSpreadsheetId.
 *  5. Prints the new spreadsheet ID so you can confirm it.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const DRIVE_FOLDER_ID   = '0AIH8muFbEdEOUk9PVA';
const ALL_USERS_ID      = '11sXbhgWolrEbKGJKPba4V6rpZQm5vjs2dRQeleL6_Uo';
const MONSTERS_DB_ID    = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const MARK_NAME         = 'Mark Mamrot';
const MARK_COMPANY      = 'Monsterthreads';
const MARK_EMAIL        = 'mark@monsterthreads.com.au'; // update if different

// --- Auth ---
function buildAuth() {
  const credsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsFile) throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set in .env');
  const credentials = JSON.parse(readFileSync(credsFile, 'utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

async function main() {
  const auth  = buildAuth();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

// Already created in a previous run — skip creation and reuse
const newUserSpreadsheetId = '1TTENKQr1ox0CCBzq_QIhjNlAWYwhJdTrwW4cW01WhRg';
console.log(`Reusing existing "User Mark Mamrot" spreadsheet: ${newUserSpreadsheetId}`);


  // 2. Ensure "Businesses" tab exists in AllUsers sheet
  console.log('\nChecking for Businesses tab in AllUsers...');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: ALL_USERS_ID });
  const existingSheets = meta.data.sheets.map(s => s.properties.title);
  
  if (!existingSheets.includes('Businesses')) {
    console.log('  Adding Businesses tab...');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ALL_USERS_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Businesses' } } }],
      },
    });
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: ALL_USERS_ID,
      range: 'Businesses!A1:E1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Name', 'User ID', 'Database ID', 'Additional User 1', 'Additional User 2']] },
    });
    console.log('  ✅ Businesses tab created with headers.');
  } else {
    console.log('  ℹ️  Businesses tab already exists.');
  }

  // 3. Append Mark's Monsterthreads row to Businesses tab
  console.log('\nWriting Monsterthreads business row...');
  await sheets.spreadsheets.values.append({
    spreadsheetId: ALL_USERS_ID,
    range: 'Businesses!A:E',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[MARK_COMPANY, newUserSpreadsheetId, MONSTERS_DB_ID, '', '']],
    },
  });
  console.log('  ✅ Monsterthreads row written.');

  // 4. Find Mark in Sheet1 and update his UserSpreadsheetId
  console.log('\nUpdating Mark Mamrot in AllUsers Sheet1...');
  // Discover the actual first-tab name (may not be "Sheet1")
  const allUsersMeta = await sheets.spreadsheets.get({ spreadsheetId: ALL_USERS_ID });
  const firstTabTitle = allUsersMeta.data.sheets[0].properties.title;
  console.log(`  Using tab: "${firstTabTitle}"`);

  const usersData = await sheets.spreadsheets.values.get({
    spreadsheetId: ALL_USERS_ID,
    range: firstTabTitle,
  });
  const rows = usersData.data.values || [];
  // Headers: Name, Company, Email, Phone, Password, UserSpreadsheetId, RegistrationDate
  let markRowIndex = rows.findIndex((r, i) => i > 0 && r[0] === MARK_NAME);

  if (markRowIndex > -1) {
    const sheetRow = markRowIndex + 1; // 1-indexed
    await sheets.spreadsheets.values.update({
      spreadsheetId: ALL_USERS_ID,
      range: `${firstTabTitle}!F${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[newUserSpreadsheetId]] },
    });
    console.log(`  ✅ Updated row ${sheetRow} UserSpreadsheetId → ${newUserSpreadsheetId}`);
  } else {
    // Insert a new row for Mark
    console.log('  Mark not found in Sheet1, inserting new row...');
    if (rows.length === 0) {
      // Write headers first
      await sheets.spreadsheets.values.update({
        spreadsheetId: ALL_USERS_ID,
        range: `${firstTabTitle}!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Name', 'Company', 'Email', 'Phone', 'Password', 'UserSpreadsheetId', 'RegistrationDate']] },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: ALL_USERS_ID,
      range: `${firstTabTitle}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[MARK_NAME, MARK_COMPANY, MARK_EMAIL, '', '', newUserSpreadsheetId, new Date().toISOString()]],
      },
    });
    console.log(`  ✅ Inserted Mark Mamrot with UserSpreadsheetId → ${newUserSpreadsheetId}`);
  }

  console.log('\n=== DONE ===');
  console.log(`New UserSpreadsheetId for Mark Mamrot: ${newUserSpreadsheetId}`);
  console.log('Update USER_SPREADSHEET_ID in .env with this value if used.');
}

main().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
