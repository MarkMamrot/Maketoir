/**
 * Phase 0+4: Add gap-fill columns and Cin7 cross-reference columns to IMS tables.
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const alterations = [
  // ── ims_products ────────────────────────────────────────────────────────────
  ['ims_products',         'style_code',          'ADD COLUMN IF NOT EXISTS style_code VARCHAR(100) NULL'],
  ['ims_products',         'is_online',            'ADD COLUMN IF NOT EXISTS is_online TINYINT(1) DEFAULT 1'],
  ['ims_products',         'supplier_contact_id',  'ADD COLUMN IF NOT EXISTS supplier_contact_id INT NULL'],
  ['ims_products',         'cin7_product_id',      'ADD COLUMN IF NOT EXISTS cin7_product_id INT NULL'],

  // ── ims_product_variants ─────────────────────────────────────────────────────
  ['ims_product_variants', 'pack_size',            'ADD COLUMN IF NOT EXISTS pack_size INT NULL'],
  ['ims_product_variants', 'cin7_option_id',       'ADD COLUMN IF NOT EXISTS cin7_option_id INT NULL'],

  // ── ims_contacts ─────────────────────────────────────────────────────────────
  ['ims_contacts',         'lead_time_days',       'ADD COLUMN IF NOT EXISTS lead_time_days INT NULL'],
  ['ims_contacts',         'cin7_supplier_id',     'ADD COLUMN IF NOT EXISTS cin7_supplier_id INT NULL'],

  // ── ims_locations ─────────────────────────────────────────────────────────────
  ['ims_locations',        'cin7_branch_id',       'ADD COLUMN IF NOT EXISTS cin7_branch_id INT NULL'],

  // ── ims_sales_orders ──────────────────────────────────────────────────────────
  ['ims_sales_orders',     'cin7_order_id',        'ADD COLUMN IF NOT EXISTS cin7_order_id VARCHAR(100) NULL'],
];

let ok = 0; let fail = 0;
for (const [table, col, clause] of alterations) {
  try {
    await conn.execute(`ALTER TABLE ${table} ${clause}`);
    console.log(`  ✅  ${table}.${col}`);
    ok++;
  } catch (e) {
    console.error(`  ❌  ${table}.${col}  —  ${e.message}`);
    fail++;
  }
}

await conn.end();
console.log(`\nDone — ${ok} added, ${fail} failed.`);
