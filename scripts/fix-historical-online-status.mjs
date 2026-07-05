/**
 * Mark the 11 historical Cin7 online orders stuck at 'confirmed' as 'fulfilled'.
 * These are pre-transition orders already processed in Cin7; the status was not
 * correctly set during the Cin7 import. Since is_historical=1, we update status
 * directly (ImsSORepo.changeStatus blocks historical records to protect stock).
 *
 * No stock movement is made — historical records never touch ims_stock.
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [result] = await c.execute(
  "UPDATE ims_sales_orders SET status = 'fulfilled' " +
  "WHERE so_type = 'online' AND is_historical = 1 AND status = 'confirmed'"
);
console.log(`✓ Updated ${result.affectedRows} historical confirmed → fulfilled.`);

await c.end();
