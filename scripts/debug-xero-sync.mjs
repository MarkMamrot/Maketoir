import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const [[{ cnt: poCount }]] = await pool.execute('SELECT COUNT(*) as cnt FROM ims_purchase_orders WHERE status NOT IN ("cancelled","draft")');
console.log('POs eligible:', poCount);

const [[{ cnt: soCount }]] = await pool.execute('SELECT COUNT(*) as cnt FROM ims_sales_orders');
console.log('Total SOs:', soCount);

const [[{ cnt: wholesaleCount }]] = await pool.execute('SELECT COUNT(*) as cnt FROM ims_sales_orders WHERE channel = "wholesale"');
console.log('Wholesale SOs:', wholesaleCount);

// Check what columns exist on ims_sales_orders
const [cols] = await pool.execute('SHOW COLUMNS FROM ims_sales_orders');
console.log('SO columns:', cols.map(c => c.Field).join(', '));

await pool.end();
