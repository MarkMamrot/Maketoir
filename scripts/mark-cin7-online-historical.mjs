/**
 * Mark all Cin7 online sales orders as historical so they are never synced to
 * Xero (they were already imported/synced via Cin7 pre-transition).
 *
 * Any online SO with a cin7_order_id (and no shopify_order_id) is a legacy Cin7
 * order — post-transition, online orders come only from Shopify.
 *
 * Usage: node scripts/mark-cin7-online-historical.mjs
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [before] = await c.execute(
  "SELECT COUNT(*) AS cnt FROM ims_sales_orders " +
  "WHERE so_type='online' AND cin7_order_id IS NOT NULL AND shopify_order_id IS NULL " +
  "AND (is_historical IS NULL OR is_historical = 0)"
);
console.log(`Cin7 online orders not yet flagged historical: ${before[0].cnt}`);

if (Number(before[0].cnt) > 0) {
  const [res] = await c.execute(
    "UPDATE ims_sales_orders SET is_historical = 1 " +
    "WHERE so_type='online' AND cin7_order_id IS NOT NULL AND shopify_order_id IS NULL " +
    "AND (is_historical IS NULL OR is_historical = 0)"
  );
  console.log(`✓ Marked ${res.affectedRows} Cin7 online orders as historical.`);
} else {
  console.log('Nothing to update.');
}

await c.end();
