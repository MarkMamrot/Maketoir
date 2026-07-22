/**
 * Migration: add pos_location_code to ims_locations in ALL tenant schemas.
 *
 * The location code is a long unique code entered once per POS device during
 * setup. It identifies both the business AND the location, replacing the old
 * location dropdown + PIN device-setup flow.
 *
 * Run: node scripts/add-pos-location-code.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

async function migrateSchema(schema) {
  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_locations' AND COLUMN_NAME = 'pos_location_code'`,
    [schema],
  );
  if (cols.length) {
    console.log(`– ${schema}: pos_location_code already exists`);
    return;
  }
  await conn.query(`ALTER TABLE \`${schema}\`.ims_locations ADD COLUMN pos_location_code VARCHAR(32) NULL`);
  await conn.query(`CREATE UNIQUE INDEX idx_pos_location_code ON \`${schema}\`.ims_locations (pos_location_code)`);
  console.log(`✓ ${schema}: added pos_location_code + unique index`);
}

try {
  // Collect all tenant schemas: env default + every mapped business.
  const schemas = new Set();
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  const mainDb = process.env.MYSQL_DATABASE;
  if (mainDb) {
    const [rows] = await conn.query(
      `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
  }
  console.log(`Tenant schemas: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await migrateSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
