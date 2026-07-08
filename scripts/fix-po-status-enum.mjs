/**
 * Migration: align ims_purchase_orders.status enum with the application.
 * The app uses 'complete' as the fully-received status, but the DB enum had
 * 'received'. This caused "Data truncated for column 'status'" on Mark Complete,
 * rolling back the receive transaction.
 *
 * Safe 3-step: widen enum → migrate rows → tighten enum.
 * Usage: node scripts/fix-po-status-enum.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

// How many legacy 'received' rows exist?
const [[before]] = await conn.query(`SELECT COUNT(*) c FROM ims_purchase_orders WHERE status = 'received'`);
console.log(`Rows currently 'received': ${before.c}`);

// Step 1 — widen enum to include BOTH 'received' and 'complete'
await conn.query(
  `ALTER TABLE ims_purchase_orders MODIFY COLUMN status
     ENUM('draft','confirmed','partially_received','received','complete','cancelled')
     NOT NULL DEFAULT 'draft'`);
console.log('✓ enum widened (received + complete)');

// Step 2 — migrate any 'received' rows to 'complete'
const [upd] = await conn.query(`UPDATE ims_purchase_orders SET status = 'complete' WHERE status = 'received'`);
console.log(`✓ migrated ${upd.affectedRows} row(s) 'received' → 'complete'`);

// Step 3 — tighten enum to the final application set
await conn.query(
  `ALTER TABLE ims_purchase_orders MODIFY COLUMN status
     ENUM('draft','confirmed','partially_received','complete','cancelled')
     NOT NULL DEFAULT 'draft'`);
console.log('✓ enum finalised: draft, confirmed, partially_received, complete, cancelled');

const [[col]] = await conn.query(`SHOW COLUMNS FROM ims_purchase_orders LIKE 'status'`);
console.log('Final:', col.Type);

await conn.end();
console.log('Done.');
process.exit(0);
