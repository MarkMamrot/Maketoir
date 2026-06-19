import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE
});

console.log('=== ims_sales_orders columns ===');
const [cols] = await conn.query('SHOW COLUMNS FROM ims_sales_orders');
console.log(cols.map(c => `${c.Field} (${c.Type})`).join('\n'));

console.log('\n=== pos_sales sample (last 10) ===');
const [posSample] = await conn.query('SELECT id, location_id, status, sale_type, total, completed_at, is_historical FROM pos_sales ORDER BY id DESC LIMIT 10');
console.log(JSON.stringify(posSample, null, 2));

console.log('\n=== pos_sales by date/location batch ===');
const [posBatches] = await conn.query(`
  SELECT DATE(completed_at) as batch_date, location_id, COUNT(*) as cnt, SUM(total) as total_amount
  FROM pos_sales WHERE status = 'completed'
  GROUP BY DATE(completed_at), location_id
  ORDER BY batch_date DESC LIMIT 10
`);
console.log(JSON.stringify(posBatches, null, 2));

console.log('\n=== online SO batches by date ===');
const [onlineBatches] = await conn.query(`
  SELECT DATE(order_date) as batch_date, location_id, so_type, COUNT(*) as cnt, SUM(total_amount) as total_amount
  FROM ims_sales_orders WHERE so_type = 'online' AND status NOT IN ('cancelled','draft')
  GROUP BY DATE(order_date), location_id, so_type
  ORDER BY batch_date DESC LIMIT 10
`);
console.log(JSON.stringify(onlineBatches, null, 2));

console.log('\n=== pos_sales columns ===');
const [posCols] = await conn.query('SHOW COLUMNS FROM pos_sales');
console.log(posCols.map(c => `${c.Field} (${c.Type})`).join(', '));

console.log('\n=== pos_eod_reconciliations columns ===');
const [eodCols] = await conn.query('SHOW COLUMNS FROM pos_eod_reconciliations');
console.log(eodCols.map(c => `${c.Field} (${c.Type})`).join(', '));

console.log('\n=== Sample pos_eod_reconciliations ===');
const [eodSample] = await conn.query('SELECT * FROM pos_eod_reconciliations ORDER BY id DESC LIMIT 5');
console.log(JSON.stringify(eodSample, null, 2));

// Check for a daily batch / aggregate table
console.log('\n=== ims_sales_cache columns ===');
const [cacheCols] = await conn.query('SHOW COLUMNS FROM ims_sales_cache');
console.log(cacheCols.map(c => `${c.Field} (${c.Type})`).join(', '));

console.log('\n=== ims_sales_history columns ===');
const [histCols] = await conn.query('SHOW COLUMNS FROM ims_sales_history');
console.log(histCols.map(c => `${c.Field} (${c.Type})`).join(', '));

console.log('\n=== All IMS tables ===');
const [tables] = await conn.query('SHOW TABLES');
console.log(tables.map(t => Object.values(t)[0]).join(', '));

await conn.end();
