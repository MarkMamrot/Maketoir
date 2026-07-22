/**
 * Fix missing tables in all IMS tenant schemas.
 * Adds ims_notifications and ensures gift_cards exist everywhere.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

async function fixSchema(schema) {
  // 1. ims_notifications
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`${schema}\`.ims_notifications (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(64)  NOT NULL,
      type        VARCHAR(20)  NOT NULL DEFAULT 'error',
      source      VARCHAR(64)  NOT NULL,
      title       VARCHAR(255) NOT NULL,
      message     TEXT         NOT NULL,
      detail      JSON         NULL,
      is_read     TINYINT(1)   NOT NULL DEFAULT 0,
      created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_noti_biz    (business_id, created_at),
      INDEX idx_noti_unread (business_id, is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 2. gift_cards (may already exist if add-gift-cards-table.mjs was run)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`${schema}\`.gift_cards (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      code                VARCHAR(100)   NOT NULL,
      initial_balance     DECIMAL(12,2)  NULL,
      balance             DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
      status              ENUM('active','redeemed','cancelled','expired') NOT NULL DEFAULT 'active',
      customer_id         VARCHAR(255)   NULL,
      order_id            VARCHAR(255)   NULL,
      shopify_location_id VARCHAR(255)   NULL,
      recipient_email     VARCHAR(255)   NULL,
      notes               TEXT           NULL,
      created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at        DATETIME       NULL,
      updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_gift_card_code (code),
      INDEX idx_gc_status   (status),
      INDEX idx_gc_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log(`✓ ${schema}: ims_notifications + gift_cards OK`);
}

try {
  const schemas = new Set();
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  const mainDb = process.env.MYSQL_DATABASE;
  if (mainDb) {
    const [rows] = await conn.query(
      `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
  }
  console.log(`Schemas: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await fixSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
