/**
 * add-wholesale-portal.mjs
 *
 * Migration: sets up the wholesale portal database schema.
 *
 * 1. Adds `password_hash VARCHAR(255) NULL` to ims_contacts in ALL IMS schemas.
 * 2. Creates `wholesale_password_reset_tokens` in the MAIN DB.
 *
 * Run:  node scripts/add-wholesale-portal.mjs
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .filter(l => l.trim() && !l.trim().startsWith('#'))
        .map(l => {
          const i = l.indexOf('=');
          const key = l.slice(0, i).trim();
          const val = l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '');
          return [key, val];
        }),
    );
  } catch {
    return {};
  }
}

const env = loadEnv();

const BASE_CONFIG = {
  host:               env.MYSQL_HOST     || process.env.MYSQL_HOST,
  port:               parseInt(env.MYSQL_PORT || process.env.MYSQL_PORT || '3306'),
  user:               env.MYSQL_USER     || process.env.MYSQL_USER,
  password:           env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  multipleStatements: false,
};

const MAIN_DB = env.MYSQL_DATABASE     || process.env.MYSQL_DATABASE;
const DEFAULT_IMS_DB = env.IMS_MYSQL_DATABASE || process.env.IMS_MYSQL_DATABASE;

async function addPasswordHashToImsDb(dbName) {
  const pool = await mysql.createPool({ ...BASE_CONFIG, database: dbName });
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'ims_contacts' AND column_name = 'password_hash'`,
      [dbName],
    );
    if (cols.length > 0) {
      console.log(`  [${dbName}] password_hash already exists — skipped`);
    } else {
      await pool.query(
        `ALTER TABLE ims_contacts ADD COLUMN password_hash VARCHAR(255) NULL AFTER email`,
      );
      console.log(`  [${dbName}] ✓ password_hash added to ims_contacts`);
    }
  } finally {
    await pool.end();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const mainPool = await mysql.createPool({ ...BASE_CONFIG, database: MAIN_DB });

// 1. Discover all IMS DB names from the businesses table
const imsDbNames = new Set([DEFAULT_IMS_DB].filter(Boolean));
try {
  const [rows] = await mainPool.query(
    `SELECT ims_db_name FROM businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
  );
  for (const r of rows) if (r.ims_db_name) imsDbNames.add(r.ims_db_name);
} catch {
  console.log('(businesses.ims_db_name not accessible — using default IMS DB only)');
}

console.log(`\nIMS schemas to migrate: ${[...imsDbNames].join(', ')}`);

// 2. Add password_hash to each IMS schema
for (const dbName of imsDbNames) {
  await addPasswordHashToImsDb(dbName);
}

// 3. Create wholesale_password_reset_tokens in MAIN DB
console.log('\nCreating wholesale_password_reset_tokens in main DB...');
await mainPool.query(`
  CREATE TABLE IF NOT EXISTS wholesale_password_reset_tokens (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    business_id  VARCHAR(100) NOT NULL,
    contact_id   INT NOT NULL,
    email        VARCHAR(255) NOT NULL,
    token        VARCHAR(64)  NOT NULL,
    expires_at   DATETIME     NOT NULL,
    used_at      DATETIME     NULL,
    created_at   DATETIME     DEFAULT NOW(),
    UNIQUE KEY uk_token (token),
    INDEX idx_contact (business_id, contact_id),
    INDEX idx_email   (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('  ✓ wholesale_password_reset_tokens ready');

// 4. Add allow_indent_wholesale to ims_products in each IMS schema
console.log('\nAdding allow_indent_wholesale column to ims_products...');
for (const dbName of imsDbNames) {
  const pool = await mysql.createPool({ ...BASE_CONFIG, database: dbName });
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'ims_products' AND column_name = 'allow_indent_wholesale'`,
      [dbName],
    );
    if (cols.length > 0) {
      console.log(`  [${dbName}] allow_indent_wholesale already exists — skipped`);
    } else {
      await pool.query(
        `ALTER TABLE ims_products ADD COLUMN allow_indent_wholesale TINYINT(1) NOT NULL DEFAULT 0`,
      );
      console.log(`  [${dbName}] ✓ allow_indent_wholesale added to ims_products`);
    }
  } finally {
    await pool.end();
  }
}

// 5. Create wholesale_draft_orders in each IMS schema
console.log('\nCreating wholesale_draft_orders tables...');
for (const dbName of imsDbNames) {
  const pool = await mysql.createPool({ ...BASE_CONFIG, database: dbName });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wholesale_draft_orders (
        id           INT          NOT NULL AUTO_INCREMENT,
        business_id  VARCHAR(64)  NOT NULL,
        contact_id   INT          NOT NULL,
        status       ENUM('draft','submitted','cancelled') NOT NULL DEFAULT 'draft',
        reference    VARCHAR(100) NULL,
        notes        TEXT         NULL,
        subtotal     DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        submitted_at DATETIME     NULL,
        so_id        INT          NULL COMMENT 'linked ims_sales_order id after submission',
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_biz_contact (business_id, contact_id),
        KEY idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wholesale_draft_order_items (
        id           INT          NOT NULL AUTO_INCREMENT,
        order_id     INT          NOT NULL,
        variant_id   VARCHAR(64)  NOT NULL,
        product_id   VARCHAR(64)  NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        variant_label VARCHAR(255) NULL,
        sku          VARCHAR(100) NULL,
        qty          INT          NOT NULL DEFAULT 1,
        unit_price   DECIMAL(10,2) NOT NULL,
        line_total   DECIMAL(10,2) NOT NULL,
        is_indent    TINYINT(1)   NOT NULL DEFAULT 0,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_order (order_id),
        CONSTRAINT fk_wdoi_order FOREIGN KEY (order_id)
          REFERENCES wholesale_draft_orders (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`  [${dbName}] ✓ wholesale_draft_orders + items ready`);
  } finally {
    await pool.end();
  }
}

await mainPool.end();

console.log('\nWholesale portal migration complete!\n');
