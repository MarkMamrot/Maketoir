/**
 * Migration: add 'partial' to ims_branch_transfers.status ENUM
 * Run: node scripts/add-bt-partial-status.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host:     process.env.IMS_MYSQL_HOST     || process.env.MYSQL_HOST,
  port:     Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user:     process.env.IMS_MYSQL_USER     || process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE || process.env.MYSQL_DATABASE,
});

try {
  await conn.execute(`
    ALTER TABLE ims_branch_transfers
    MODIFY COLUMN status ENUM('draft','sent','partial','received','cancelled')
      NOT NULL DEFAULT 'draft'
  `);
  console.log('✓ Added partial to ims_branch_transfers.status ENUM');
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await conn.end();
}
