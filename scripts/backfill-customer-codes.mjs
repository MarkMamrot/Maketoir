/**
 * Backfill: assign a C-XXXXXX customer code to every ims_contacts row that
 * currently has no customer_code (NULL or empty string).
 *
 * Uses the auto-increment primary key as the unique seed so codes never
 * collide. Existing codes (e.g. Lightspeed "CUST-10023") are untouched.
 *
 * Safe to re-run — the WHERE clause guards already-populated rows.
 *
 * Usage:
 *   node scripts/backfill-customer-codes.mjs
 */
import mysql  from 'mysql2/promise';
import dotenv from 'dotenv';
import path   from 'path';
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

async function backfillSchema(schema) {
  try {
    const [result] = await conn.query(
      `UPDATE \`${schema}\`.ims_contacts
          SET customer_code = CONCAT('C-', LPAD(id, 6, '0'))
        WHERE customer_code IS NULL OR customer_code = ''`,
    );
    console.log(`✓ ${schema}: updated ${result.affectedRows} contact(s)`);
  } catch (e) {
    console.error(`✗ ${schema}: ${e.message}`);
  }
}

try {
  const schemas = new Set();
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  const mainDb = process.env.MYSQL_DATABASE;
  if (mainDb) {
    const [rows] = await conn.query(
      `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
  }
  if (!schemas.size) {
    console.error('No tenant schemas found. Check MYSQL_DATABASE / IMS_MYSQL_DATABASE env vars.');
    process.exit(1);
  }
  console.log(`Schemas to backfill: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await backfillSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
