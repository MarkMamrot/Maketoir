import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

// POS sales
const [r1] = await conn.execute(
  `UPDATE ims_stock_movements SET channel = 'pos' WHERE movement_type = 'pos_sale' AND channel IS NULL`
);
console.log(`pos_sale: ${r1.affectedRows} rows → 'pos'`);

// SO movements — join to ims_sales_orders to get so_type
const [r2] = await conn.execute(
  `UPDATE ims_stock_movements sm
   JOIN ims_sales_orders so ON so.id = sm.reference_id
   SET sm.channel = CASE WHEN so.so_type = 'online' THEN 'online' ELSE 'wholesale' END
   WHERE sm.movement_type IN ('so_confirmed','so_unconfirmed','so_fulfilled')
     AND sm.channel IS NULL`
);
console.log(`SO movements: ${r2.affectedRows} rows → 'wholesale'/'online'`);

// Verify
const [check] = await conn.execute(
  `SELECT movement_type, channel, COUNT(*) AS cnt FROM ims_stock_movements GROUP BY movement_type, channel ORDER BY movement_type, channel`
);
console.log('\nResult:');
console.table(check);

await conn.end();
