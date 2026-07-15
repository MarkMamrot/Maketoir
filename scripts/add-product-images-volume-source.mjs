/**
 * Migration: Add 'volume' to ims_product_images.source ENUM.
 * Run once: node scripts/add-product-images-volume-source.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

try {
  await conn.execute(`
    ALTER TABLE ims_product_images
    MODIFY COLUMN source ENUM('shopify','google_drive','external','volume') NOT NULL DEFAULT 'external'
  `);
  console.log("✅  source ENUM updated — 'volume' added");
} catch (e) {
  console.error('❌  alter failed —', e.message);
}

await conn.end();
