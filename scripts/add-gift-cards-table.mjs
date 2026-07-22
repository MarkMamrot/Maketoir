/**
 * Migration: create gift_cards table in ALL IMS tenant schemas.
 *
 * Run: node scripts/add-gift-cards-table.mjs
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

async function migrateSchema(schema) {
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_cards'`,
    [schema],
  );
  if (tables.length) {
    console.log(`– ${schema}: gift_cards already exists`);
    return;
  }
  await conn.query(`
    CREATE TABLE \`${schema}\`.gift_cards (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      code                VARCHAR(100)   NOT NULL,
      initial_balance     DECIMAL(12,2)  NULL     COMMENT 'Face value when issued; NULL = unknown (imported)',
      balance             DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
      status              ENUM('active','redeemed','cancelled','expired') NOT NULL DEFAULT 'active',
      customer_id         VARCHAR(255)   NULL     COMMENT 'External customer ID (Shopify UUID, etc.)',
      order_id            VARCHAR(255)   NULL     COMMENT 'External order ID, "imported", or NULL for manual',
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
  console.log(`✓ ${schema}: created gift_cards table`);
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
  console.log(`Schemas to migrate: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await migrateSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
