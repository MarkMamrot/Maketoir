/**
 * Catch-up migration: add all columns that exist in Monsterthreads but are
 * missing from other IMS tenant schemas.
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS throughout.
 * Run: node scripts/catchup-schema-all-tenants.mjs
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

// Column definitions: [table, column, definition]
const COLUMNS = [
  // ── ims_purchase_orders ──────────────────────────────────────────────────
  ['ims_purchase_orders', 'xero_bill_id',            'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'xero_synced_at',           'DATETIME NULL'],
  ['ims_purchase_orders', 'xero_sync_status',         "ENUM('synced','queued','error') NULL"],
  ['ims_purchase_orders', 'cin7_order_id',            'VARCHAR(50) NULL'],
  ['ims_purchase_orders', 'is_historical',            'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_purchase_orders', 'supplier_invoice_number',  'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'supplier_invoice_date',    'DATE NULL'],
  ['ims_purchase_orders', 'payment_terms',            'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'currency_code',            "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_purchase_orders', 'exchange_rate',            'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_purchase_orders', 'cin7_contact_id',          'INT NULL'],
  ['ims_purchase_orders', 'tax_treatment',            "ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax'"],
  ['ims_purchase_orders', 'tax_code',                 'VARCHAR(50) NULL'],
  ['ims_purchase_orders', 'supplier_name_raw',        'VARCHAR(255) NULL'],
  // ── ims_sales_orders ─────────────────────────────────────────────────────
  ['ims_sales_orders', 'customer_po_number',  'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_invoice_id',     'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_sales_orders', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_sales_orders', 'shopify_order_name',  'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'cin7_order_id',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'is_historical',       'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_sales_orders', 'payment_terms',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'freight',             'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'discount',            'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'currency_code',       "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_sales_orders', 'exchange_rate',       'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_sales_orders', 'cin7_member_id',      'INT NULL'],
  ['ims_sales_orders', 'tax_code',            'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'payment_gateway',     'VARCHAR(255) NULL'],
  ['ims_sales_orders', 'refunded_amount',     'DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'financial_status',    'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'returned_at',         'DATETIME NULL'],
  // ── ims_product_variants ─────────────────────────────────────────────────
  ['ims_product_variants', 'cost_aud',                  'DECIMAL(12,4) NULL'],
  ['ims_product_variants', 'avg_cost',                  'DECIMAL(15,4) NULL'],
  ['ims_product_variants', 'price_rrp',                 'DECIMAL(12,2) NULL'],
  ['ims_product_variants', 'price_wholesale',           'DECIMAL(10,4) NULL'],
  ['ims_product_variants', 'price_rrp_sale',            'DECIMAL(12,2) NULL'],
  ['ims_product_variants', 'cost_foreign',              'TEXT NULL'],
  ['ims_product_variants', 'pack_size',                 'INT NULL'],
  ['ims_product_variants', 'cin7_option_id',            'INT NULL'],
  ['ims_product_variants', 'bin',                       'VARCHAR(100) NULL'],
  ['ims_product_variants', 'zone',                      'VARCHAR(100) NULL'],
  ['ims_product_variants', 'volume',                    'TINYINT UNSIGNED NULL'],
  ['ims_product_variants', 'shopify_inventory_item_id', 'VARCHAR(100) NULL'],
  // ── ims_stock ────────────────────────────────────────────────────────────
  ['ims_stock', 'zone', 'VARCHAR(50) NULL'],
  ['ims_stock', 'bin',  'VARCHAR(50) NULL'],
  // ── ims_locations ────────────────────────────────────────────────────────
  ['ims_locations', 'phone',          'VARCHAR(50) NULL'],
  ['ims_locations', 'pos_pin',        'VARCHAR(20) NULL'],
  ['ims_locations', 'cin7_branch_id', 'INT NULL'],
  ['ims_locations', 'has_pos',        'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_wholesale',  'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_online',     'TINYINT(1) NOT NULL DEFAULT 0'],
  // ── ims_contacts ─────────────────────────────────────────────────────────
  ['ims_contacts', 'password_hash',   'VARCHAR(255) NULL'],
  ['ims_contacts', 'cin7_contact_id', 'INT NULL'],
];

async function migrateSchema(schema) {
  // Load existing columns once per schema
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [schema],
  );
  const existing = new Set(rows.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

  let added = 0, skipped = 0;
  for (const [table, col, def] of COLUMNS) {
    if (existing.has(`${table}.${col}`)) { skipped++; continue; }
    try {
      await conn.query(`ALTER TABLE \`${schema}\`.\`${table}\` ADD COLUMN \`${col}\` ${def}`);
      added++;
    } catch (e) {
      console.error(`  ✗ ${schema}.${table}.${col}: ${e.message}`);
    }
  }
  console.log(`✓ ${schema}: added ${added}, skipped ${skipped} (already existed)`);
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
  for (const schema of schemas) await migrateSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
