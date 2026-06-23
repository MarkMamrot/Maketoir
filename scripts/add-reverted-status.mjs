import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +(process.env.MYSQL_PORT || 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});
await conn.execute(
  "ALTER TABLE ims_stocktakes MODIFY COLUMN status ENUM('draft','in_progress','completed','cancelled','reverted') NOT NULL DEFAULT 'draft'"
);
console.log('✓ status ENUM updated to include reverted');
await conn.end();
