/**
 * Migration: Add business_id column to ims_shopify_sync_log
 * Safe to re-run — uses INFORMATION_SCHEMA check.
 * Run once: node scripts/add-shopify-log-business-id.mjs
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

const [cols] = await conn.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_shopify_sync_log' AND COLUMN_NAME = 'business_id'`,
  [env.IMS_MYSQL_DATABASE]
);

const [tables] = await conn.execute(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_shopify_sync_log'`,
  [env.IMS_MYSQL_DATABASE]
);

if (tables.length === 0) {
  // Table doesn't exist — create it with business_id already included
  await conn.execute(`
    CREATE TABLE ims_shopify_sync_log (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(100) NOT NULL DEFAULT '',
      action      ENUM('reconcile','upload','sync_prices','resync') NOT NULL,
      status      ENUM('success','error','partial') NOT NULL,
      summary     TEXT NOT NULL,
      detail      JSON NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ssl_created (created_at),
      INDEX idx_ssl_biz_created (business_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅  Created ims_shopify_sync_log table (with business_id).');
} else if (cols.length === 0) {
  // Table exists but missing business_id
  await conn.execute(
    `ALTER TABLE ims_shopify_sync_log
     ADD COLUMN business_id VARCHAR(100) NOT NULL DEFAULT '' AFTER id`
  );
  await conn.execute(
    `ALTER TABLE ims_shopify_sync_log
     ADD INDEX idx_ssl_biz_created (business_id, created_at)`
  );
  console.log('✅  Added business_id column + index to ims_shopify_sync_log.');
} else {
  console.log('ℹ️  ims_shopify_sync_log already has business_id, skipping.');
}

await conn.end();
