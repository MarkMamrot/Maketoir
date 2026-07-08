/**
 * Data migration: convert any legacy ims_sales_order_refunds rows into unified
 * Shopify-source credit notes (status='complete'). Historical stock was already
 * restocked at the time, so this creates records ONLY — no stock movements.
 *
 * Idempotent: skips refunds already represented by a credit note
 * (matched on shopify_refund_id). Safe to re-run.
 *
 * Usage: node scripts/migrate-refunds-to-cn.mjs
 * NOTE: run add-cn-returns-linkage.mjs first.
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

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const [refunds] = await conn.query(
  `SELECT r.*, so.so_number, so.customer_id, so.location_id
     FROM ims_sales_order_refunds r
     JOIN ims_sales_orders so ON so.id = r.so_id`);
console.log('Legacy refund rows:', refunds.length);

let migrated = 0, skipped = 0;
for (const r of refunds) {
  const [[dup]] = await conn.query(
    `SELECT id FROM ims_credit_notes WHERE business_id=? AND shopify_refund_id=? LIMIT 1`,
    [r.business_id, String(r.shopify_refund_id)]);
  if (dup) { skipped++; continue; }

  // Next CN number for this business.
  const [[mx]] = await conn.query(
    `SELECT MAX(CAST(REGEXP_REPLACE(cn_number,'[^0-9]','') AS UNSIGNED)) m FROM ims_credit_notes WHERE business_id=?`,
    [r.business_id]);
  const cnNumber = `CN-${String((Number(mx.m ?? 0) + 1)).padStart(5, '0')}`;

  const total = round2(r.amount);
  const tax = round2(r.tax_amount);
  const base = round2(total - tax);
  const taxRate = base > 0 ? round2(tax / base) : 0;
  const cnDate = (r.created_at ? new Date(r.created_at) : new Date()).toISOString().slice(0, 10);

  const [res] = await conn.query(
    `INSERT INTO ims_credit_notes
       (business_id, cn_number, customer_id, so_id, original_so_number, location_id,
        status, source, shopify_refund_id, cn_date, completed_at, reference,
        tax_treatment, subtotal, tax_amount, total_amount, notes)
     VALUES (?,?,?,?,?,?, 'complete','shopify',?, ?, ?, ?, 'inc_tax', ?, ?, ?, ?)`,
    [r.business_id, cnNumber, r.customer_id ?? null, r.so_id, r.so_number ?? null, r.location_id,
     String(r.shopify_refund_id), cnDate, r.created_at ?? null,
     `Shopify refund ${r.shopify_refund_id}`, base, tax, total, r.note ?? null]);
  await conn.query(
    `INSERT INTO ims_credit_note_items
       (cn_id, name, qty, unit_price, price_basis, tax_rate, restock, line_total)
     VALUES (?,?,1,?, 'custom', ?, 0, ?)`,
    [res.insertId, `Shopify refund ${r.shopify_refund_id}`, base, taxRate, base]);
  migrated++;
}

console.log(`Migrated ${migrated}, skipped ${skipped} (already present).`);
console.log('When verified, retire the table:  RENAME TABLE ims_sales_order_refunds TO _archived_ims_sales_order_refunds;');
await conn.end();
process.exit(0);
