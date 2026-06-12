/**
 * POS Tables Setup Script
 * Run with: node scripts/setup-pos-tables.mjs
 *
 * Creates the 4 POS tables in the IMS database and extends
 * ims_stock_movements enum values for pos_sale / pos_return.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const IMS_DB = process.env.IMS_MYSQL_DATABASE || 'readyedu_MonsterthreadsIMS';

const DDL = [
  `CREATE TABLE IF NOT EXISTS pos_users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255),
    email         VARCHAR(255),
    phone         VARCHAR(50),
    branch_ids    JSON,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS pos_sales (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    local_id          VARCHAR(100) UNIQUE,
    location_id       INT NOT NULL,
    cashier_id        INT NOT NULL,
    sale_type         ENUM('sale','return','layby') NOT NULL DEFAULT 'sale',
    status            ENUM('open','parked','completed','voided','layby_active','layby_complete') NOT NULL DEFAULT 'open',
    customer_name     VARCHAR(255),
    customer_phone    VARCHAR(50),
    subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
    total             DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes             TEXT,
    parked_label      VARCHAR(100),
    return_of_sale_id INT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at      DATETIME,
    FOREIGN KEY (location_id) REFERENCES ims_locations(id),
    FOREIGN KEY (cashier_id)  REFERENCES pos_users(id),
    INDEX idx_pos_loc_date (location_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS pos_sale_items (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    sale_id         INT NOT NULL,
    variant_id      VARCHAR(36),
    code            VARCHAR(100),
    name            VARCHAR(500) NOT NULL,
    qty             DECIMAL(12,4) NOT NULL,
    unit_price      DECIMAL(12,2) NOT NULL,
    original_price  DECIMAL(12,2),
    discount_type   ENUM('none','percent','amount') NOT NULL DEFAULT 'none',
    discount_value  DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_rate        DECIMAL(5,2)  NOT NULL DEFAULT 10.00,
    line_total      DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE CASCADE,
    INDEX idx_psi_sale (sale_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS pos_payments (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    sale_id        INT NOT NULL,
    payment_method VARCHAR(100) NOT NULL,
    amount         DECIMAL(12,2) NOT NULL,
    reference      VARCHAR(255),
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE CASCADE,
    INDEX idx_pp_sale   (sale_id),
    INDEX idx_pp_method (payment_method, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS pos_eod_reconciliations (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    location_id       INT NOT NULL,
    cashier_id        INT NOT NULL,
    recon_date        DATE NOT NULL,
    payment_method    VARCHAR(100) NOT NULL,
    expected_amount   DECIMAL(12,2),
    counted_amount    DECIMAL(12,2),
    opening_float     DECIMAL(12,2),
    denomination_data JSON,
    notes             TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_eod (location_id, recon_date, payment_method),
    INDEX idx_eod_loc_date (location_id, recon_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Extend ims_stock_movements enum to include POS movement types
const ALTER_STATEMENTS = [
  `ALTER TABLE ims_stock_movements
   MODIFY COLUMN movement_type ENUM(
     'po_approved','po_unapproved','po_received',
     'so_confirmed','so_unconfirmed','so_fulfilled',
     'adjustment','transfer_in','transfer_out',
     'pos_sale','pos_return'
   ) NOT NULL`,

  `ALTER TABLE ims_stock_movements
   MODIFY COLUMN reference_type ENUM(
     'purchase_order','sales_order','manual','pos_sale'
   ) NOT NULL`,
];

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.MYSQL_HOST     || 'localhost',
    port:     parseInt(process.env.MYSQL_PORT || '3306', 10),
    user:     process.env.MYSQL_USER     || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: IMS_DB,
  });

  try {
    console.log(`\n➜  Connected to "${IMS_DB}"…`);

    for (const stmt of DDL) {
      const tableName = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] ?? '';
      await conn.execute(stmt);
      console.log(`✓  Table ready: ${tableName}`);
    }

    for (const stmt of ALTER_STATEMENTS) {
      try {
        await conn.execute(stmt);
        console.log(`✓  ALTER applied.`);
      } catch (err) {
        // Ignore "duplicate column" / enum already-exists type errors
        console.warn(`⚠  ALTER skipped (may already be applied):`, err.message);
      }
    }

    console.log('\n✅  POS tables setup complete!\n');
    console.log('Next steps:');
    console.log('  1. Create the first POS user via /setup (POS tab) in the app.');
    console.log('  2. Navigate to /pos and set up your device.\n');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('✗  Setup failed:', err.message);
  process.exit(1);
});
