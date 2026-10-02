import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');

const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const settingsDdl = schema.match(/CREATE TABLE IF NOT EXISTS klaviyo_integration_settings \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
if (!settingsDdl) throw new Error('Canonical klaviyo_integration_settings definition not found.');

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

try {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'klaviyo_integration_settings'`,
    [database],
  );
  console.log(`Klaviyo main-schema plan for ${database}: settings table ${rows.length ? 'already exists' : 'will be created'}.`);
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
  } else {
    await connection.query(settingsDdl);
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'klaviyo_integration_settings'`,
      [database],
    );
    if (columns.length !== 16) {
      throw new Error(`Expected 16 klaviyo_integration_settings columns, found ${columns.length}.`);
    }
    console.log('Klaviyo main schema applied successfully.');
  }
} finally {
  await connection.end();
}