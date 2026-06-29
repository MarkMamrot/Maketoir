/**
 * Extends existing enums for credit note support and seeds the xero_account_mappings
 * row for the `credit_note` role_key in each business that already has Xero connected.
 * Run: node scripts/add-credit-note-enums.mjs
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// ── IMS database (stock movements) ───────────────────────────────────────────
const ims = await createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// Extend movement_type enum
try {
  await ims.execute(`
    ALTER TABLE ims_stock_movements
    MODIFY COLUMN movement_type ENUM(
      'purchase','sale','adjustment','transfer_out','transfer_in',
      'stocktake','return','po_received','po_unapproved',
      'so_committed','so_shipped','so_uncommitted','so_returned',
      'cn_returned'
    ) NOT NULL
  `);
  console.log('✅ ims_stock_movements.movement_type: added cn_returned');
} catch (e) {
  console.warn('⚠️  movement_type alter skipped (may already include cn_returned):', e.message);
}

// Extend reference_type enum
try {
  await ims.execute(`
    ALTER TABLE ims_stock_movements
    MODIFY COLUMN reference_type ENUM(
      'purchase_order','sales_order','branch_transfer','stocktake',
      'manual','pos_sale','online_sale','credit_note'
    ) NOT NULL
  `);
  console.log('✅ ims_stock_movements.reference_type: added credit_note');
} catch (e) {
  console.warn('⚠️  reference_type alter skipped (may already include credit_note):', e.message);
}

await ims.end();

// ── Main/Marketoir database (xero_account_mappings) ──────────────────────────
const main = await createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

// Seed credit_note role_key for businesses that have sales_revenue mapped
const [existing] = await main.execute(`
  SELECT DISTINCT business_id FROM xero_account_mappings
  WHERE role_key = 'sales_revenue'
    AND business_id NOT IN (
      SELECT business_id FROM xero_account_mappings WHERE role_key = 'credit_note'
    )
`);
if (existing.length) {
  for (const row of existing) {
    await main.execute(
      `INSERT IGNORE INTO xero_account_mappings (business_id, role_key, account_code, label)
       SELECT ?, 'credit_note', account_code, 'Credit Notes'
       FROM xero_account_mappings
       WHERE business_id = ? AND role_key = 'sales_revenue'
       LIMIT 1`,
      [row.business_id, row.business_id],
    );
    console.log(`✅ Seeded credit_note mapping for business ${row.business_id}`);
  }
} else {
  console.log('ℹ️  No new businesses to seed (all already have credit_note mapping).');
}

await main.end();
