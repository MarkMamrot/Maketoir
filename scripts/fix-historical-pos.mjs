import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: 'readyedu_MonsterthreadsIMS',
});

const [r] = await conn.execute(
  `UPDATE ims_purchase_orders SET is_historical = 1
   WHERE (status = 'received' OR status = 'cancelled')
     AND cin7_order_id IS NOT NULL
     AND is_historical = 0`,
);
console.log(`POs marked historical: ${r.affectedRows}`);

// Also show counts for sanity check
const [rows] = await conn.query(
  `SELECT is_historical, status, COUNT(*) AS cnt
   FROM ims_purchase_orders WHERE cin7_order_id IS NOT NULL
   GROUP BY is_historical, status ORDER BY is_historical, status`,
);
console.table(rows);

await conn.end();
