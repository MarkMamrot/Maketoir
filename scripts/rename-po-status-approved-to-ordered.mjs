/**
 * Migration: Rename PO status 'approved' → 'ordered' in ims_purchase_orders.
 *
 * Run once against the IMS database:
 *   node scripts/rename-po-status-approved-to-ordered.mjs
 *
 * Safe to re-run — the ENUM is widened first, data is migrated, then the old
 * value is removed. If the old value is already gone, the final ALTER is a no-op.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  database:       process.env.IMS_MYSQL_DATABASE,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

console.log(`Connected to ${process.env.IMS_MYSQL_DATABASE}`);

// Step 1: Widen ENUM to include both values
await conn.execute(`
  ALTER TABLE ims_purchase_orders
    MODIFY COLUMN status ENUM('draft','approved','ordered','partially_received','received','cancelled') NOT NULL DEFAULT 'draft'
`);
console.log('✓ ENUM widened to include both approved and ordered');

// Step 2: Migrate existing rows
const [result] = await conn.execute(`
  UPDATE ims_purchase_orders SET status = 'ordered' WHERE status = 'approved'
`);
console.log(`✓ Migrated ${result.affectedRows} rows from 'approved' → 'ordered'`);

// Step 3: Remove old value from ENUM
await conn.execute(`
  ALTER TABLE ims_purchase_orders
    MODIFY COLUMN status ENUM('draft','ordered','partially_received','received','cancelled') NOT NULL DEFAULT 'draft'
`);
console.log('✓ ENUM narrowed — \'approved\' value removed');

await conn.end();
console.log('\nDone. Deploy the updated code and the rename is complete.');
