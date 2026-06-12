/**
 * Brands Table Setup Script
 * Run with: node scripts/setup-brands-table.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     ?? 'localhost',
  user:     process.env.MYSQL_USER     ?? '',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.IMS_MYSQL_DATABASE,
  port:     Number(process.env.MYSQL_PORT) || 3306,
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_brands (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_brand_name (name)
  )
`);

console.log('✅ ims_brands table created (or already exists)');
await conn.end();
