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

const TABLE_DDLS = [
  `CREATE TABLE IF NOT EXISTS ims_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    cn_number           VARCHAR(30)  NOT NULL,
    customer_id         INT          NULL,
    so_id               INT          NULL,
    original_so_number  VARCHAR(100) NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','awaiting_product','complete','cancelled') NOT NULL DEFAULT 'draft',
    source              ENUM('manual','shopify') NOT NULL DEFAULT 'manual',
    shopify_return_id   VARCHAR(100) NULL,
    cn_date             DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL,
    tax_treatment       ENUM('ex_tax','inc_tax') NOT NULL DEFAULT 'ex_tax',
    tax_code            VARCHAR(50)  NULL,
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    created_by          VARCHAR(150) NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_customer (customer_id),
    INDEX idx_shopify_return (business_id, shopify_return_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    cn_id        INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
    price_basis  ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom',
    restock      TINYINT(1)    NOT NULL DEFAULT 1,
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_cn (cn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    scn_number          VARCHAR(30)  NOT NULL,
    supplier_id         INT          NULL,
    po_id               INT          NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','complete','cancelled') NOT NULL DEFAULT 'draft',
    scn_date            DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL,
    supplier_credit_ref VARCHAR(100) NULL,
    currency_code       VARCHAR(10)  NOT NULL DEFAULT 'AUD',
    exchange_rate       DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
    tax_treatment       ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    created_by          VARCHAR(150) NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_business_scn (business_id, scn_number),
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_supplier (supplier_id),
    INDEX idx_po (po_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    scn_id       INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_cost    DECIMAL(12,4) NOT NULL DEFAULT 0,
    restock      TINYINT(1)    NOT NULL DEFAULT 1,
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_scn (scn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_files (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    scn_id        INT          NOT NULL,
    business_id   VARCHAR(100) NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    mime_type     VARCHAR(100),
    file_size     INT,
    uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scn (scn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

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
  // ── ims_credit_notes ─────────────────────────────────────────────────────
  ['ims_credit_notes', 'so_id',               'INT NULL'],
  ['ims_credit_notes', 'original_so_number',  'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'source',              "ENUM('manual','shopify') NOT NULL DEFAULT 'manual'"],
  ['ims_credit_notes', 'shopify_return_id',   'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'completed_at',        'DATETIME NULL'],
  ['ims_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_credit_note_items ────────────────────────────────────────────────
  ['ims_credit_note_items', 'price_basis',    "ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom'"],
  ['ims_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
  // ── ims_supplier_credit_notes ────────────────────────────────────────────
  ['ims_supplier_credit_notes', 'supplier_credit_ref', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'currency_code',       "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_supplier_credit_notes', 'exchange_rate',       'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_supplier_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_supplier_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_supplier_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_supplier_credit_note_items ───────────────────────────────────────
  ['ims_supplier_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
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
  ['ims_locations', 'manager_pin_hash', 'VARCHAR(255) NULL'],
  ['ims_locations', 'cin7_branch_id', 'INT NULL'],
  ['ims_locations', 'has_pos',        'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_wholesale',  'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_online',     'TINYINT(1) NOT NULL DEFAULT 0'],
  // ── ims_contacts ─────────────────────────────────────────────────────────
  ['ims_contacts', 'password_hash',   'VARCHAR(255) NULL'],
  ['ims_contacts', 'cin7_contact_id', 'INT NULL'],
  ['ims_contacts', 'shopify_customer_id', 'VARCHAR(100) NULL'],
];

const INDEXES = [
  ['ims_contacts', 'idx_shopify_customer_id', 'UNIQUE INDEX `idx_shopify_customer_id` (`business_id`, `shopify_customer_id`)'],
  ['ims_credit_notes', 'idx_shopify_return', 'INDEX `idx_shopify_return` (`business_id`, `shopify_return_id`)'],
  ['ims_supplier_credit_notes', 'uq_business_scn', 'UNIQUE INDEX `uq_business_scn` (`business_id`, `scn_number`)'],
];

async function ensureEnumValues(schema, table, column, requiredValues) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [schema, table, column],
  );
  const row = rows[0];
  if (!row || typeof row.COLUMN_TYPE !== 'string' || !row.COLUMN_TYPE.toLowerCase().startsWith('enum(')) return;

  const existingValues = [];
  const regex = /'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = regex.exec(row.COLUMN_TYPE)) !== null) {
    existingValues.push(match[1].replace(/\\'/g, "'"));
  }

  const missing = requiredValues.filter(v => !existingValues.includes(v));
  if (!missing.length) return;

  const merged = [...existingValues, ...missing];
  const enumSql = merged.map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(',');
  const nullSql = row.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
  const defaultSql = row.COLUMN_DEFAULT === null ? '' : ` DEFAULT ${conn.escape(row.COLUMN_DEFAULT)}`;

  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\` MODIFY COLUMN \`${column}\` ENUM(${enumSql}) ${nullSql}${defaultSql}`,
  );
}

async function migrateSchema(schema) {
  for (const ddl of TABLE_DDLS) {
    try {
      await conn.query(`USE \`${schema}\``);
      await conn.query(ddl);
    } catch (e) {
      console.error(`  ✗ ${schema} table bootstrap: ${e.message}`);
    }
  }

  // Load existing columns once per schema
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [schema],
  );
  const existing = new Set(rows.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const [indexRows] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`,
    [schema],
  );
  const existingIndexes = new Set(indexRows.map(r => `${r.TABLE_NAME}.${r.INDEX_NAME}`));

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

  let indexesAdded = 0, indexesSkipped = 0;
  for (const [table, indexName, def] of INDEXES) {
    if (existingIndexes.has(`${table}.${indexName}`)) { indexesSkipped++; continue; }
    try {
      await conn.query(`ALTER TABLE \`${schema}\`.\`${table}\` ADD ${def}`);
      indexesAdded++;
    } catch (e) {
      console.error(`  ✗ ${schema}.${table}.${indexName}: ${e.message}`);
    }
  }

  try {
    await ensureEnumValues(schema, 'ims_credit_notes', 'status', ['draft', 'awaiting_product', 'complete', 'cancelled']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'movement_type', ['cn_returned', 'scn_returned']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'reference_type', ['credit_note', 'supplier_credit_note']);
  } catch (e) {
    console.error(`  ✗ ${schema} enum catch-up: ${e.message}`);
  }

  console.log(`✓ ${schema}: added ${added} columns, skipped ${skipped}, added ${indexesAdded} indexes, skipped ${indexesSkipped}`);
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
