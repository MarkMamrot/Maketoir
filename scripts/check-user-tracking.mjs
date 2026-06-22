import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

async function addColIfMissing(table, col, definition) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
  if (cols.length) { console.log(`  ${table}.${col} already exists`); return; }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  console.log(`  Added ${table}.${col}`);
}

console.log('Running migration...');
await addColIfMissing('pos_sales', 'trading_date', 'DATE NULL AFTER location_id');
console.log('Done.');

await conn.end();
