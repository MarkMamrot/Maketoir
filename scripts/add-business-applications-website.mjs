/**
 * Migration: add `website` column to business_applications.
 * Run with: node scripts/add-business-applications-website.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

async function columnExists(table, column) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows[0].cnt > 0;
}

if (await columnExists('business_applications', 'website')) {
  console.log('  – Already exists: business_applications.website');
} else {
  await conn.execute(
    `ALTER TABLE business_applications ADD COLUMN website VARCHAR(255) NULL AFTER business_name`,
  );
  console.log('  ✓ Added column: business_applications.website');
}

await conn.end();
console.log('Done.');
