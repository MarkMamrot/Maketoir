/**
 * Migration: add business_id column to all IMS tables missing it,
 * then backfill all existing rows with the Monsterthreads business_id.
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const BIZ_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

// Tables that need the column — child tables last so parent indexes exist first
const TABLES = [
  // Core entity tables
  { name: 'ims_products',                after: 'id' },
  { name: 'ims_product_variants',        after: 'id' },
  { name: 'ims_brands',                  after: 'id' },
  { name: 'ims_contacts',                after: 'id' },
  { name: 'ims_locations',               after: 'id' },
  { name: 'ims_stock',                   after: 'id' },
  { name: 'ims_stock_movements',         after: 'id' },
  // Purchase orders
  { name: 'ims_purchase_orders',         after: 'id' },
  { name: 'ims_purchase_order_items',    after: 'id' },
  { name: 'ims_purchase_order_payments', after: 'id' },
  { name: 'ims_po_landed_costs',         after: 'id' },
  // Sales orders
  { name: 'ims_sales_orders',            after: 'id' },
  { name: 'ims_sales_order_items',       after: 'id' },
  { name: 'ims_sales_order_payments',    after: 'id' },
  // Branch transfers
  { name: 'ims_branch_transfers',        after: 'id' },
  { name: 'ims_branch_transfer_items',   after: 'id' },
  // Stocktakes
  { name: 'ims_stocktakes',              after: 'id' },
  { name: 'ims_stocktake_items',         after: 'id' },
  // Sales analytics cache (no id — use variant_id as first column)
  { name: 'ims_sales_cache',             after: 'variant_id' },
  { name: 'ims_sales_history',           after: 'id' },
  // POS
  { name: 'pos_sales',                   after: 'id' },
  { name: 'pos_sale_items',              after: 'id' },
  { name: 'pos_payments',                after: 'id' },
  { name: 'pos_eod_reconciliations',     after: 'id' },
  { name: 'pos_users',                   after: 'id' },
];

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE, ssl: { rejectUnauthorized: false },
  connectTimeout: 20000,
});

for (const { name: table, after } of TABLES) {
  // Check if column already exists
  const [cols] = await c.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'business_id'`);
  if (cols.length > 0) {
    console.log(`SKIP  ${table} — already has business_id`);
    continue;
  }

  try {
    await c.query(`ALTER TABLE \`${table}\` ADD COLUMN business_id VARCHAR(100) NOT NULL DEFAULT '' AFTER \`${after}\``);
    const [res] = await c.query(`UPDATE \`${table}\` SET business_id = ?`, [BIZ_ID]);
    await c.query(`ALTER TABLE \`${table}\` ADD INDEX idx_business_id (business_id)`);
    console.log(`DONE  ${table} — backfilled ${res.affectedRows} rows`);
  } catch (e) {
    console.error(`ERROR ${table}: ${e.message}`);
  }
}

await c.end();
console.log('\nMigration complete.');
