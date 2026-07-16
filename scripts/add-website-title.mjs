/**
 * add-website-title.mjs
 *
 * Adds the `website_title` column to `ims_products`.
 * Used as the Shopify product title instead of the supplier-assigned `name`.
 * Falls back to `name` when blank.
 *
 * Usage: node scripts/add-website-title.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const [[existing]] = await db.execute(
  `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_products' AND COLUMN_NAME = 'website_title'`,
  [process.env.IMS_MYSQL_DATABASE]
);

if (existing.cnt > 0) {
  console.log('✓ website_title column already exists — nothing to do.');
} else {
  await db.execute(
    `ALTER TABLE ims_products ADD COLUMN website_title VARCHAR(500) NULL DEFAULT NULL AFTER tags`
  );
  console.log('✓ Added website_title column to ims_products.');
}

await db.end();
