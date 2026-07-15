/**
 * Migration: add max_locations, max_users, cost_per_location to businesses table.
 * Run with: node scripts/add-business-caps.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const cols = [
  { name: 'max_locations',     def: 'INT DEFAULT NULL COMMENT "NULL = unlimited"' },
  { name: 'max_users',         def: 'INT DEFAULT NULL COMMENT "NULL = unlimited"' },
  { name: 'cost_per_location', def: 'DECIMAL(10,2) DEFAULT NULL COMMENT "Monthly cost per location (AUD)"' },
];

for (const col of cols) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = ?`,
    [col.name],
  );
  if (rows[0].cnt === 0) {
    await conn.execute(`ALTER TABLE businesses ADD COLUMN ${col.name} ${col.def}`);
    console.log(`  ✓ Added column: ${col.name}`);
  } else {
    console.log(`  – Already exists: ${col.name}`);
  }
}

await conn.end();
console.log('Done.');
