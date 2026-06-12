#!/usr/bin/env node
/**
 * migrate-business-data.mjs
 * For each business_id (spreadsheetId) in MySQL businesses table,
 * reads the business's Google Sheet and migrates:
 *   - Config tab → config table
 *   - BusinessInfo tab → business_info table
 *   - BrandProfile tab → brand_profile table
 *
 * Usage: node scripts/migrate-business-data.mjs
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

async function safeGet(spreadsheetId, range) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return data.values ?? [];
  } catch {
    return [];
  }
}

// Get all businesses from MySQL
const [businesses] = await conn.execute('SELECT business_id FROM businesses');
console.log(`Migrating ${businesses.length} business(es)...\n`);

for (const { business_id } of businesses) {
  console.log(`▶ ${business_id}`);

  // --- Config ---
  const configRows = await safeGet(business_id, 'Config!A:B');
  for (const [key, value] of configRows) {
    if (!key) continue;
    await conn.execute(
      'INSERT INTO config (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [business_id, key, value ?? ''],
    );
  }
  console.log(`  Config: ${configRows.length} rows`);

  // --- BusinessInfo ---
  const biRows = await safeGet(business_id, 'BusinessInfo!A:G');
  if (biRows.length > 1) {
    const r = biRows[1];
    await conn.execute(
      `INSERT INTO business_info (business_id, brand_name, brand_url, years_in_business,
         facebook_link, instagram_link, pinterest_link)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         brand_name=VALUES(brand_name), brand_url=VALUES(brand_url),
         years_in_business=VALUES(years_in_business), facebook_link=VALUES(facebook_link),
         instagram_link=VALUES(instagram_link), pinterest_link=VALUES(pinterest_link)`,
      [business_id, r[1]||null, r[2]||null, r[3]||null, r[4]||null, r[5]||null, r[6]||null],
    );
    console.log(`  BusinessInfo: saved`);
  }

  // --- BrandProfile ---
  const bpRows = await safeGet(business_id, 'BrandProfile!A:U');
  if (bpRows.length > 1) {
    const r = bpRows[1];
    await conn.execute(
      `INSERT INTO brand_profile
         (business_id, mission, uvp, tone, demographics, geo, hero_products,
          price_positioning, praises, objections, competitors, market_gap,
          logo_url, brand_colours, shipping_policy, connected_software,
          operations_summary, returns_policy, brand_history, physical_branches, loyalty_program)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         mission=VALUES(mission), uvp=VALUES(uvp), tone=VALUES(tone),
         demographics=VALUES(demographics), geo=VALUES(geo),
         hero_products=VALUES(hero_products), price_positioning=VALUES(price_positioning),
         praises=VALUES(praises), objections=VALUES(objections),
         competitors=VALUES(competitors), market_gap=VALUES(market_gap),
         logo_url=VALUES(logo_url), brand_colours=VALUES(brand_colours),
         shipping_policy=VALUES(shipping_policy), connected_software=VALUES(connected_software),
         operations_summary=VALUES(operations_summary), returns_policy=VALUES(returns_policy),
         brand_history=VALUES(brand_history), physical_branches=VALUES(physical_branches),
         loyalty_program=VALUES(loyalty_program)`,
      [business_id,
       r[1]||null, r[2]||null, r[3]||null, r[4]||null, r[5]||null,
       r[6]||null, r[7]||null, r[8]||null, r[9]||null, r[10]||null,
       r[11]||null, r[12]||null, r[13]||null, r[14]||null, r[15]||null,
       r[16]||null, r[17]||null, r[18]||null, r[19]||null, r[20]||null],
    );
    console.log(`  BrandProfile: saved`);
  }

  console.log('');
}

console.log('Migration complete.');
await conn.end();
