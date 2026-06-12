import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'exam-ready.com.au',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  database: process.env.MYSQL_DATABASE || 'readyedu_Solvantis',
  user: process.env.MYSQL_USER || 'readyedu_Admin',
  password: process.env.MYSQL_PASSWORD || 'Mamrot1981#',
  connectionLimit: 2,
});

const BIZ_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

// Get the real website sheet ID from config
const [cfgRows] = await pool.query(
  'SELECT value FROM config WHERE business_id = ? AND `key` = ?',
  [BIZ_ID, 'WebsiteSheetId']
);
const websiteSheetId = cfgRows[0]?.value ?? null;
console.log('WebsiteSheetId from config:', websiteSheetId);

// Move GA4PropertyId (currently in website_sheet_id) to ga4_property_id
// and set website_sheet_id to the correct value
const [r] = await pool.query(
  'UPDATE connections SET ga4_property_id = website_sheet_id, website_sheet_id = ? WHERE business_id = ?',
  [websiteSheetId, BIZ_ID]
);
console.log('connections rows updated:', r.affectedRows);

const [[after]] = await pool.query(
  'SELECT website_sheet_id, ga4_property_id FROM connections WHERE business_id = ?',
  [BIZ_ID]
);
console.log('After fix:', after);

await pool.end();
