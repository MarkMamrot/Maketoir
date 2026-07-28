import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const bizId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const imsDb = 'readyedu_MonsterthreadsIMS';

const [xsl] = await conn.query(
  `SELECT detail, status, xero_id, created_at FROM xero_sync_log
    WHERE business_id=? AND sync_type='online_batch' ORDER BY created_at DESC`,
  [bizId],
);
console.log('ONLINE_BATCH_SYNC_LOG', JSON.stringify(xsl, null, 2));

const [batches] = await conn.query(
  `SELECT DATE_FORMAT(batch_date, '%Y-%m-%d') AS batch_date, xero_invoice_id, invoice_status, payout_managed
     FROM xero_online_batches WHERE business_id=? ORDER BY batch_date DESC LIMIT 20`,
  [bizId],
);
console.log('\nXERO_ONLINE_BATCHES', JSON.stringify(batches, null, 2));

const [dayRows] = await conn.query(
  `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day, COUNT(*) AS c, CAST(SUM(total_amount) AS DECIMAL(10,2)) AS total
     FROM ${imsDb}.ims_sales_orders
    WHERE so_type='online' AND status NOT IN ('cancelled','draft')
    GROUP BY day ORDER BY day DESC LIMIT 20`,
);
console.log('\nIMS_ONLINE_DAYS', JSON.stringify(dayRows, null, 2));

await conn.end();
