import 'dotenv/config';
import mysql from 'mysql2/promise';

const imsDb = process.env.IMS_MYSQL_DATABASE;
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: imsDb,
});

// 1. Check IMS DB for zone/bin columns
const [mktCols] = await pool.query(
  `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ?
     AND (COLUMN_NAME LIKE '%zone%' OR COLUMN_NAME LIKE '%bin%' OR COLUMN_NAME LIKE '%location%')`,
  [imsDb]
);
console.log(`\n=== IMS DB (${imsDb}) zone/bin/location columns ===`);
mktCols.forEach(c => console.log(`  ${c.TABLE_NAME}.${c.COLUMN_NAME}`));

// 2. Check IMS DB for zone/bin columns (same, just alias for clarity)
const imsCols = mktCols;

// 3. Sample any tables with zone/bin — show values
for (const col of mktCols) {
  const [rows] = await pool.query(
    `SELECT ${col.COLUMN_NAME} FROM \`${col.TABLE_NAME}\` WHERE ${col.COLUMN_NAME} IS NOT NULL AND ${col.COLUMN_NAME} != '' LIMIT 3`
  );
  if (rows.length) {
    console.log(`\nSample values for ${col.TABLE_NAME}.${col.COLUMN_NAME}:`);
    rows.forEach(r => console.log('  ', JSON.stringify(r)));
  }
}

// 4. All tables in IMS DB
console.log(`\n=== All tables in ${imsDb} ===`);
const [tables] = await pool.query(`SHOW TABLES`);
tables.forEach(t => console.log('  ', Object.values(t)[0]));

// 5. Show columns for products/stock/variant tables
for (const t of tables) {
  const name = Object.values(t)[0];
  if (/product|stock|variant/i.test(name)) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${name}\``);
    console.log(`\nColumns in ${name}:`);
    cols.forEach(c => console.log(`  ${c.Field} (${c.Type})`));
  }
}

await pool.end();
