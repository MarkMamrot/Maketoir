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

// 1. Add 'stocktake' to movement_type ENUM
await conn.execute(`
  ALTER TABLE ims_stock_movements
  MODIFY COLUMN movement_type ENUM(
    'po_approved','po_unapproved','po_received',
    'so_confirmed','so_unconfirmed','so_fulfilled',
    'adjustment','transfer_in','transfer_out',
    'pos_sale','pos_return','stocktake'
  ) NOT NULL
`);
console.log('✓ movement_type ENUM updated');

// 2. Add 'stocktake' to reference_type ENUM
await conn.execute(`
  ALTER TABLE ims_stock_movements
  MODIFY COLUMN reference_type ENUM(
    'purchase_order','sales_order','manual','pos_sale','stocktake'
  ) NOT NULL
`);
console.log('✓ reference_type ENUM updated');

// 3. Add Xero sync fields to ims_stocktakes (add each separately to avoid IF NOT EXISTS multi-column issue)
const [cols] = await conn.execute(`SHOW COLUMNS FROM ims_stocktakes`);
const colNames = cols.map((c) => c.Field);
if (!colNames.includes('xero_journal_id')) {
  await conn.execute(`ALTER TABLE ims_stocktakes ADD COLUMN xero_journal_id VARCHAR(100) NULL AFTER completed_at`);
  console.log('✓ xero_journal_id added');
}
if (!colNames.includes('xero_synced_at')) {
  await conn.execute(`ALTER TABLE ims_stocktakes ADD COLUMN xero_synced_at DATETIME NULL AFTER xero_journal_id`);
  console.log('✓ xero_synced_at added');
}
if (!colNames.includes('xero_sync_status')) {
  await conn.execute(`ALTER TABLE ims_stocktakes ADD COLUMN xero_sync_status ENUM('synced','queued','error') NULL AFTER xero_synced_at`);
  console.log('✓ xero_sync_status added');
}
console.log('✓ ims_stocktakes xero fields OK');

await conn.end();
console.log('All migrations complete.');
