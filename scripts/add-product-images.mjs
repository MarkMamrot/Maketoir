/**
 * Migration: Add ims_product_images table.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 * Usage: node scripts/add-product-images.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ims_product_images (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      product_id   VARCHAR(36) NOT NULL,
      url          TEXT NOT NULL,
      source       ENUM('shopify','google_drive','external') NOT NULL DEFAULT 'external',
      drive_file_id VARCHAR(200) NULL,
      is_primary   TINYINT(1) NOT NULL DEFAULT 0,
      sort_order   INT NOT NULL DEFAULT 0,
      alt_text     VARCHAR(255) NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES ims_products(product_id) ON DELETE CASCADE,
      INDEX idx_pi_product (product_id),
      INDEX idx_pi_primary (product_id, is_primary)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅  ims_product_images table created');
} catch (e) {
  console.error('❌  ims_product_images —', e.message);
}

await conn.end();
console.log('\nDone. Run: node scripts/add-product-images.mjs');
