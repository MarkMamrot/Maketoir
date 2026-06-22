#!/usr/bin/env node
/**
 * Adds pos_pin column to ims_locations table.
 * Run once: node scripts/add-pos-pin-column.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.IMS_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

try {
  await conn.query('ALTER TABLE ims_locations ADD COLUMN IF NOT EXISTS pos_pin VARCHAR(20) NULL AFTER is_active');
  console.log('✓ pos_pin column added to ims_locations (or already existed).');
} catch (e) {
  console.error('Failed:', e.message);
} finally {
  await conn.end();
}
