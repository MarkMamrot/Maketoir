import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// Backfill legacy stocktake and branch-transfer rows that pre-date business_id.
// Usage:
//   BUSINESS_ID=<business_id> IMS_DB=<schema_name> node scripts/backfill-stocktake-bt-business-id.mjs
// Defaults to the original Monsterthreads business/schema for the legacy shared IMS database.

dotenv.config({ path: '.env' });

const businessId = process.env.BUSINESS_ID || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const database = process.env.IMS_DB || process.env.IMS_MYSQL_DATABASE || 'readyedu_MonsterthreadsIMS';

const conn = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
  multipleStatements: false,
});

async function ensureColumn(table) {
  const [cols] = await conn.execute(`SHOW COLUMNS FROM ${table} LIKE 'business_id'`);
  if (!cols.length) {
    await conn.execute(`ALTER TABLE ${table} ADD COLUMN business_id VARCHAR(100) NOT NULL DEFAULT '' AFTER id`);
    await conn.execute(`ALTER TABLE ${table} ADD INDEX idx_${table}_business_id (business_id)`).catch(() => {});
  }
}

await ensureColumn('ims_stocktakes');
await ensureColumn('ims_branch_transfers');

const [stocktakeResult] = await conn.execute(
  `UPDATE ims_stocktakes SET business_id = ? WHERE business_id IS NULL OR business_id = ''`,
  [businessId],
);
const [btResult] = await conn.execute(
  `UPDATE ims_branch_transfers SET business_id = ? WHERE business_id IS NULL OR business_id = ''`,
  [businessId],
);

console.log(JSON.stringify({
  database,
  businessId,
  stocktakesUpdated: stocktakeResult.affectedRows ?? 0,
  branchTransfersUpdated: btResult.affectedRows ?? 0,
}, null, 2));

await conn.end();
