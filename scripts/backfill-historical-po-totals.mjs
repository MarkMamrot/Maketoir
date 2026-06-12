/**
 * backfill-historical-po-totals.mjs
 *
 * Fixes historical (Cin7) purchase orders where subtotal and total_amount
 * were stored as 0 due to a bug in the original import (l.lineTotal was null
 * in the Cin7 API response — the correct field is l.total).
 *
 * This script recalculates subtotal from ims_purchase_order_items.line_total
 * and sets total_amount = subtotal + tax_amount + freight - discount.
 *
 * Note: tax_amount and freight remain as-is (0 for existing records). To
 * get proper tax/freight values, re-run "Import Purchase Orders" in IMS
 * Settings after this fix — re-importing will update existing POs with the
 * correct values from the Cin7 API.
 */

import 'dotenv/config';
import { createPool } from 'mysql2/promise';

const pool = createPool({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// Find historical POs where subtotal = 0 but line items exist
const [zeros] = await pool.query(`
  SELECT po.id, po.po_number, po.tax_amount, po.freight, po.discount,
         COALESCE(SUM(i.line_total), 0) AS calc_subtotal,
         COUNT(i.id) AS line_count
  FROM ims_purchase_orders po
  LEFT JOIN ims_purchase_order_items i ON i.po_id = po.id
  WHERE po.is_historical = 1 AND po.subtotal = 0
  GROUP BY po.id
  HAVING line_count > 0
`);

console.log(`Found ${zeros.length} historical POs with subtotal=0 but have line items.`);
if (zeros.length === 0) { console.log('Nothing to fix.'); await pool.end(); process.exit(0); }

let fixed = 0;
for (const row of zeros) {
  const subtotal    = Number(row.calc_subtotal);
  const taxAmount   = Number(row.tax_amount);
  const freight     = Number(row.freight);
  const discount    = Number(row.discount);
  const totalAmount = subtotal + taxAmount + freight - discount;

  await pool.execute(
    `UPDATE ims_purchase_orders SET subtotal=?, total_amount=? WHERE id=?`,
    [subtotal, totalAmount, row.id],
  );
  fixed++;
  console.log(`  Fixed ${row.po_number}: subtotal=${subtotal.toFixed(2)}, total=${totalAmount.toFixed(2)}`);
}

console.log(`\nDone — fixed ${fixed} purchase orders.`);
console.log('Tip: Re-run "Import Purchase Orders" in IMS Settings to also pick up correct tax and freight from Cin7.');

await pool.end();
