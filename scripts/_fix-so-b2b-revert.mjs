/**
 * Revert a single SO back to B2B wholesale (ex-tax).
 * Usage: node scripts/_fix-so-b2b-revert.mjs <so_number>
 *
 * Reverses what fix-so-online-retail-tax-fast.mjs did:
 *   - so_type       = 'b2b'
 *   - price_tier    = 'wholesale'
 *   - tax_treatment = 'ex_tax'
 *   - subtotal      = SUM(line_total)           (line prices are already ex-tax)
 *   - tax_amount    = SUM(line_total * tax_rate)
 *   - total_amount  = subtotal + tax + freight - discount
 *   - is_historical = 0  (it's a real B2B order, not a historical online import)
 */
import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const soNumber = process.argv[2];
if (!soNumber) { console.error('Usage: node scripts/_fix-so-b2b-revert.mjs <so_number>'); process.exit(1); }

const conn = await mysql.createConnection({
  host:     process.env.IMS_MYSQL_HOST     ?? process.env.MYSQL_HOST,
  port:     Number(process.env.IMS_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 3306),
  user:     process.env.IMS_MYSQL_USER     ?? process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
});

// 1. Show current state
const [[so]] = await conn.execute(
  `SELECT so.id, so.so_number, so.so_type, so.price_tier, so.tax_treatment,
          so.subtotal, so.tax_amount, so.total_amount, so.freight, so.discount,
          so.cin7_order_id, so.shopify_order_id, so.is_historical,
          c.name AS customer_name
     FROM ims_sales_orders so
     LEFT JOIN ims_contacts c ON c.id = so.customer_id
    WHERE so.so_number = ?`,
  [soNumber]
);

if (!so) { console.error(`SO "${soNumber}" not found.`); await conn.end(); process.exit(1); }

console.log('\nCurrent state:');
console.table([so]);

// 2. Show line items
const [lines] = await conn.execute(
  `SELECT id, notes, qty_ordered, unit_price, tax_rate, line_total
     FROM ims_sales_order_items
    WHERE so_id = ?
    ORDER BY id`,
  [so.id]
);
console.log('Line items:');
console.table(lines);

// 3. Recalculate as ex-tax wholesale
const [result] = await conn.execute(`
  UPDATE ims_sales_orders so
  JOIN (
    SELECT
      soi.so_id,
      ROUND(SUM(soi.line_total), 2)                                          AS new_subtotal,
      ROUND(SUM(CASE WHEN soi.tax_rate > 0 THEN soi.line_total * soi.tax_rate ELSE 0 END), 2) AS new_tax
    FROM ims_sales_order_items soi
    WHERE soi.so_id = ?
    GROUP BY soi.so_id
  ) totals ON totals.so_id = so.id
  SET
    so.so_type       = 'b2b',
    so.price_tier    = 'wholesale',
    so.tax_treatment = 'ex_tax',
    so.is_historical = 0,
    so.subtotal      = totals.new_subtotal,
    so.tax_amount    = totals.new_tax,
    so.total_amount  = ROUND(totals.new_subtotal + totals.new_tax
                            + COALESCE(so.freight, 0)
                            - COALESCE(so.discount, 0), 2)
  WHERE so.id = ?
`, [so.id, so.id]);

console.log(`\nUpdated ${result.affectedRows} row(s).`);

// 4. Show new state
const [[updated]] = await conn.execute(
  `SELECT so_number, so_type, price_tier, tax_treatment, subtotal, tax_amount, total_amount, is_historical
     FROM ims_sales_orders WHERE id = ?`,
  [so.id]
);
console.log('New state:');
console.table([updated]);

await conn.end();
