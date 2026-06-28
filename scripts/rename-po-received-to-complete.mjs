/**
 * Migration: rename PO status 'received' → 'complete'
 * Run once against the IMS database.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_IMS_DATABASE ?? process.env.MYSQL_DATABASE,
  ssl:      process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const [result] = await conn.execute(
  `UPDATE ims_purchase_orders SET status = 'complete' WHERE status = 'received'`
);
console.log(`✅  Updated ${result.affectedRows} purchase order(s): status received → complete`);

await conn.end();
