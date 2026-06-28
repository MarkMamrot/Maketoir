// Migration: create pos_chat_messages table
// Run: node scripts/add-pos-chat.mjs

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     +(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  ssl:      process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

console.log('Connected to IMS DB. Creating pos_chat_messages...');

await conn.execute(`
  CREATE TABLE IF NOT EXISTS pos_chat_messages (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    location_id   INT NOT NULL,
    location_name VARCHAR(255) NOT NULL DEFAULT '',
    user_name     VARCHAR(255) NOT NULL DEFAULT '',
    avatar        VARCHAR(100) NOT NULL DEFAULT '',
    message       TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

console.log('✓ pos_chat_messages table created (or already exists).');
await conn.end();
