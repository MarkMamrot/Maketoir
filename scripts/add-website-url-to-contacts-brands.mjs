// Migration: add website_url column to ims_contacts and ims_brands
// Run: node scripts/add-website-url-to-contacts-brands.mjs

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

console.log('Connected. Adding website_url columns…');

await conn.execute(
  `ALTER TABLE ims_contacts ADD COLUMN website_url VARCHAR(500) NULL`
).catch(e => { if (!e.message.includes('Duplicate column')) throw e; });
console.log('✓ ims_contacts.website_url');

await conn.execute(
  `ALTER TABLE ims_brands ADD COLUMN website_url VARCHAR(500) NULL`
).catch(e => { if (!e.message.includes('Duplicate column')) throw e; });
console.log('✓ ims_brands.website_url');

await conn.end();
console.log('Done.');
