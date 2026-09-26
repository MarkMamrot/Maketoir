import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  const [rows] = await connection.execute(
    `SELECT status, xero_state, COUNT(DISTINCT xero_id) AS count
       FROM xero_sync_log
      WHERE sync_type = 'so_invoice_void'
        AND created_at >= '2026-09-26 04:45:00'
      GROUP BY status, xero_state
      ORDER BY status, xero_state`,
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
