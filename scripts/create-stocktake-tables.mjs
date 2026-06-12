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

console.log('Connected to', process.env.IMS_MYSQL_DATABASE);

// Index on barcode for fast barcode lookup during stocktake
await conn.execute(`
  ALTER TABLE ims_product_variants
  ADD INDEX IF NOT EXISTS idx_pv_barcode (barcode)
`);
console.log('✓ barcode index OK');

// Stocktake header table
await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_stocktakes (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    reference    VARCHAR(100)  NOT NULL,
    location_id  INT           NOT NULL,
    status       ENUM('draft','in_progress','completed','cancelled') NOT NULL DEFAULT 'draft',
    notes        TEXT          NULL,
    created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME      NULL,
    INDEX idx_st_location (location_id),
    INDEX idx_st_status   (status)
  )
`);
console.log('✓ ims_stocktakes OK');

// Stocktake line items
await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_stocktake_items (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    stocktake_id  INT             NOT NULL,
    variant_id    VARCHAR(36)     NOT NULL,
    expected_qty  DECIMAL(12,4)   NOT NULL DEFAULT 0,
    counted_qty   DECIMAL(12,4)   NULL,
    notes         VARCHAR(255)    NULL,
    INDEX idx_sti_stocktake (stocktake_id),
    UNIQUE KEY uq_sti_variant (stocktake_id, variant_id)
  )
`);
console.log('✓ ims_stocktake_items OK');

await conn.end();
console.log('Done.');
