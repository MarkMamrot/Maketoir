import 'dotenv/config';
import mysql from 'mysql2/promise';

const main = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const [rows] = await main.execute(`
  SELECT id, status, xero_id, detail, created_at
  FROM xero_sync_log
  WHERE business_id = ?
    AND sync_type = 'scn_attachment'
    AND reference_id = ?
  ORDER BY id DESC
  LIMIT 10
`, ['1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps', 2]);
console.table(rows);
await main.end();
