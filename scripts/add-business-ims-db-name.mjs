/**
 * Adds businesses.ims_db_name (the per-business IMS schema on the shared MySQL
 * server) and backfills the existing business with the current env default.
 *
 *   node scripts/add-business-ims-db-name.mjs
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const main = await createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

// 1. Add the column if missing (MySQL 9 has no ADD COLUMN IF NOT EXISTS).
const [cols] = await main.execute(`SHOW COLUMNS FROM businesses LIKE 'ims_db_name'`);
if (!cols.length) {
  await main.execute(`ALTER TABLE businesses ADD COLUMN ims_db_name VARCHAR(150) NULL AFTER has_pos`);
  console.log('✔ added businesses.ims_db_name');
} else {
  console.log('• businesses.ims_db_name already exists');
}

// 2. Backfill: any IMS-enabled business with no schema set → current env default.
const defaultDb = process.env.IMS_MYSQL_DATABASE ?? '';
if (defaultDb) {
  const [res] = await main.execute(
    `UPDATE businesses SET ims_db_name = ?
      WHERE (ims_db_name IS NULL OR ims_db_name = '')
        AND has_ims = 1 AND deleted_at IS NULL`,
    [defaultDb],
  );
  console.log(`✔ backfilled ${res.affectedRows} business(es) → ${defaultDb}`);
}

const [rows] = await main.execute(
  `SELECT business_id, name, has_ims, ims_db_name FROM businesses WHERE deleted_at IS NULL`);
console.table(rows.map(r => ({ name: r.name, has_ims: r.has_ims, ims_db_name: r.ims_db_name })));

await main.end();
console.log('\n✅ Done.');
