/**
 * Migration: add category + subcategory columns to ims_products
 * in every business IMS database on this server.
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 *
 *   node scripts/add-product-category-subcategory.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── 1. Find all active IMS database names ─────────────────────────────────────
const mainConn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const [bizRows] = await mainConn.execute(
  `SELECT name, ims_db_name
   FROM businesses
   WHERE has_ims = 1 AND deleted_at IS NULL AND ims_db_name IS NOT NULL AND ims_db_name <> ''
   ORDER BY name`
);
await mainConn.end();

if (!bizRows.length) {
  // Fall back to the single env-configured IMS database
  const fallback = process.env.IMS_MYSQL_DATABASE;
  if (!fallback) { console.error('No IMS databases found and IMS_MYSQL_DATABASE is not set.'); process.exit(1); }
  bizRows.push({ name: '(default)', ims_db_name: fallback });
}

console.log(`\nMigrating ${bizRows.length} IMS database(s)…\n`);

// ── 2. Run ALTER TABLE on each database ───────────────────────────────────────
let totalOk = 0; let totalFail = 0;

for (const { name, ims_db_name } of bizRows) {
  const conn = await mysql.createConnection({
    host:     process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST,
    port:     parseInt(process.env.MYSQL_PORT || '3306'),
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: ims_db_name,
    connectTimeout: 20000,
  });

  const [colRows] = await conn.execute(`SHOW COLUMNS FROM ims_products`);
  const existing = new Set(colRows.map(r => r.Field));

  const migrations = [
    { col: 'category',    sql: `ALTER TABLE ims_products ADD COLUMN category    VARCHAR(255) NULL AFTER tags` },
    { col: 'subcategory', sql: `ALTER TABLE ims_products ADD COLUMN subcategory VARCHAR(255) NULL AFTER category` },
  ];

  let dbOk = 0;
  for (const { col, sql } of migrations) {
    if (existing.has(col)) {
      console.log(`  •   ${ims_db_name}.ims_products.${col}  already exists`);
      dbOk++;
      continue;
    }
    try {
      await conn.execute(sql);
      console.log(`  ✅  ${ims_db_name}.ims_products.${col}  added  (${name})`);
      dbOk++;
    } catch (e) {
      console.error(`  ❌  ${ims_db_name}.ims_products.${col}: ${e.message}`);
      totalFail++;
    }
  }
  totalOk += dbOk;
  await conn.end();
}

console.log(`\n✅  Done — ${totalOk} columns confirmed, ${totalFail} errors.`);
if (totalFail > 0) process.exit(1);
