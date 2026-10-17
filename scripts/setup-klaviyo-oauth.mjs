import 'dotenv/config';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
if (!process.env.MYSQL_DATABASE) throw new Error('MYSQL_DATABASE is required.');
const schema = await fs.readFile(new URL('./marketoir-schema.sql', import.meta.url), 'utf8');
const definition = schema.match(/CREATE TABLE IF NOT EXISTS klaviyo_oauth_connections \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
if (!definition) throw new Error('Canonical Klaviyo OAuth schema not found.');
const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
try {
  const [rows] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'klaviyo_oauth_connections'`, [process.env.MYSQL_DATABASE]);
  console.log(`Klaviyo OAuth table: ${rows.length ? 'exists' : 'will be created'}.`);
  if (apply) {
    await connection.query(definition);
    const [columns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'klaviyo_oauth_connections'`, [process.env.MYSQL_DATABASE]);
    const names = new Set(columns.map(row => row.COLUMN_NAME));
    for (const column of ['business_id', 'access_token', 'refresh_token', 'expires_at', 'scopes', 'updated_at']) {
      if (!names.has(column)) throw new Error(`Klaviyo OAuth schema is missing ${column}.`);
    }
    console.log('Klaviyo OAuth table applied and verified. No accounts connected or enabled.');
  } else console.log('Dry run only. Use --apply to create the table.');
} finally { await connection.end(); }