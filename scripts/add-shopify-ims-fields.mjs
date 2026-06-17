/**
 * Migration: Add Shopify IMS integration fields.
 * Safe to re-run — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 * Usage:  node scripts/add-shopify-ims-fields.mjs
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

// 1. Add shopify_inventory_item_id to ims_product_variants
try {
  await conn.execute(
    `ALTER TABLE ims_product_variants
     ADD COLUMN IF NOT EXISTS shopify_inventory_item_id VARCHAR(100) NULL`
  );
  console.log('✅  ims_product_variants.shopify_inventory_item_id');
} catch (e) {
  console.error('❌  ims_product_variants.shopify_inventory_item_id —', e.message);
}

// 2. Create ims_shopify_sync_log table
try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ims_shopify_sync_log (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      action     ENUM('reconcile','upload','sync_prices','resync') NOT NULL,
      status     ENUM('success','error','partial') NOT NULL,
      summary    TEXT NOT NULL,
      detail     JSON NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ssl_created (created_at)
    )
  `);
  console.log('✅  ims_shopify_sync_log table');
} catch (e) {
  console.error('❌  ims_shopify_sync_log —', e.message);
}

await conn.end();
console.log('\nDone.');
