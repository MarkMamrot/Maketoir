/**
 * Migration: add pos_pin_hash column to users table for POS PIN login.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST ?? 'localhost',
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'pos_pin_hash'`,
    [process.env.MYSQL_DATABASE],
  );
  if (cols.length) {
    console.log('  pos_pin_hash already exists — skipping.');
  } else {
    await conn.execute(`ALTER TABLE users ADD COLUMN pos_pin_hash VARCHAR(255) NULL AFTER password_hash`);
    console.log('✓ Added pos_pin_hash to users');
  }
} finally {
  await conn.end();
}
