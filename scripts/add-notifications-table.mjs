// Migration: create ims_notifications table
// Run: node scripts/add-notifications-table.mjs

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

console.log('Connected to IMS DB. Creating ims_notifications…');

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_notifications (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(64)  NOT NULL,
    type        VARCHAR(20)  NOT NULL DEFAULT 'error',
    source      VARCHAR(64)  NOT NULL,
    title       VARCHAR(255) NOT NULL,
    message     TEXT         NOT NULL,
    detail      JSON         NULL,
    is_read     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_noti_biz    (business_id, created_at),
    INDEX idx_noti_unread (business_id, is_read)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

console.log('✓ ims_notifications table created (or already exists).');
await conn.end();
