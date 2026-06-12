#!/usr/bin/env node
/**
 * migrate-connections.mjs
 * For each business in MySQL, reads the Connections tab from Google Sheets
 * and copies encrypted credentials to the MySQL connections table.
 * Credentials remain AES-256 encrypted (same key) — just moving storage location.
 *
 * Usage: node scripts/migrate-connections.mjs
 */
import 'dotenv/config';
import { google } from 'googleapis';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  credentials: process.env.GOOGLE_CLIENT_EMAIL ? {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key:  (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  } : undefined,
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const sheets = google.sheets({ version: 'v4', auth });

// Matches the old HEADERS array in business-connections route
// Maps header name → connections table column
const COLUMN_MAP = {
  ShopifyShopId:        'shopify_shop_id',
  ShopifyAccessToken:   'shopify_access_token',
  WebsiteSheetId:       'website_sheet_id',
  GA4PropertyId:        'ga4_property_id',
  GoogleAdsCustomerId:  'google_ads_customer_id',
  MetaAdAccountId:      'meta_ad_account_id',
  MetaAccessToken:      'meta_access_token',
  Cin7AccountId:        'cin7_account_id',
  Cin7ApiKey:           'cin7_api_key',
  GmailAddress:         'gmail_email',
  GmailRefreshToken:    'gmail_refresh_token',
  KlaviyoApiKey:        'klaviyo_api_key',
};

const [businesses] = await conn.execute('SELECT business_id FROM businesses');
console.log(`Migrating connections for ${businesses.length} business(es)...\n`);

for (const { business_id } of businesses) {
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: business_id,
      range: 'Connections!A1:M2',
    });
    const rows = data.values ?? [];
    if (rows.length < 2) {
      console.log(`  ${business_id}: no connections data`);
      continue;
    }

    const headers = rows[0];
    const values  = rows[1];

    const dbData = {};
    headers.forEach((h, i) => {
      const col = COLUMN_MAP[h];
      if (col) dbData[col] = values[i] || null;
    });

    const fields = Object.keys(dbData);
    if (fields.length === 0) continue;

    const setClauses = fields.map(f => `${f} = VALUES(${f})`).join(', ');
    const vals = fields.map(f => dbData[f]);
    await conn.execute(
      `INSERT INTO connections (business_id, ${fields.join(', ')})
       VALUES (?, ${fields.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClauses}, updated_at = NOW()`,
      [business_id, ...vals],
    );
    console.log(`  ✓ ${business_id}: ${fields.length} connection fields saved`);
  } catch (e) {
    console.log(`  ⚠ ${business_id}: ${e.message}`);
  }
}

console.log('\nApplying config-table overrides...');
// Some Sheets Connections tabs have stale/wrong values for WebsiteSheetId
// (e.g. the GA4 property ID stored there by mistake).
// We trust the MySQL config table over Sheets for these fields.
const CONFIG_OVERRIDES = {
  'WebsiteSheetId': 'website_sheet_id',
};
for (const { business_id } of businesses) {
  try {
    for (const [cfgKey, dbCol] of Object.entries(CONFIG_OVERRIDES)) {
      const [[row]] = await conn.execute(
        'SELECT `value` FROM config WHERE business_id = ? AND `key` = ?',
        [business_id, cfgKey],
      );
      if (row?.value) {
        await conn.execute(
          `UPDATE connections SET ${dbCol} = ? WHERE business_id = ?`,
          [row.value, business_id],
        );
        console.log(`  ✓ ${business_id}: overrode ${dbCol} from config (${row.value})`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ ${business_id} override: ${e.message}`);
  }
}

console.log('\nDone.');
await conn.end();
