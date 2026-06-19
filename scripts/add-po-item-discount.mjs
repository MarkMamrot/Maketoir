import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  database:       process.env.IMS_MYSQL_DATABASE,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

try {
  await conn.execute(
    'ALTER TABLE ims_purchase_order_items ADD COLUMN IF NOT EXISTS discount_pct DECIMAL(8,4) NOT NULL DEFAULT 0 AFTER unit_cost'
  );
  console.log('Added discount_pct to ims_purchase_order_items');
} catch (e) {
  console.error(e.message);
}

await conn.end();
