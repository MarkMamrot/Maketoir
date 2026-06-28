/**
 * Migration: rename PO status 'received' → 'complete'
 * Run once against the IMS database.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_IMS_DATABASE ?? process.env.MYSQL_DATABASE,
  ssl:      process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Step 1: Add 'complete' to the ENUM (keep 'received' so existing rows are still valid)
const [alterResult] = await conn.execute(
  `ALTER TABLE ims_purchase_orders
   MODIFY COLUMN status ENUM('draft','confirmed','partially_received','received','complete','cancelled') NOT NULL DEFAULT 'draft'`
);
console.log('✅  ENUM updated: added complete alongside received');

// Step 2: Migrate data
const [result] = await conn.execute(
  `UPDATE ims_purchase_orders SET status = 'complete' WHERE status = 'received'`
);
console.log(`✅  Updated ${result.affectedRows} purchase order(s): status received → complete`);

// Step 3: Remove 'received' from ENUM now that all rows are migrated
await conn.execute(
  `ALTER TABLE ims_purchase_orders
   MODIFY COLUMN status ENUM('draft','confirmed','partially_received','complete','cancelled') NOT NULL DEFAULT 'draft'`
);
console.log('✅  ENUM updated: removed received, final values: draft|confirmed|partially_received|complete|cancelled');

await conn.end();
