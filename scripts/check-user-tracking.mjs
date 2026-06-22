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

async function makeNullable(table, col, typeDef) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
  if (!cols.length || cols[0].Null === 'YES') { console.log(`  ${table}.${col} already nullable`); return; }
  await conn.query(`ALTER TABLE ${table} MODIFY COLUMN ${col} ${typeDef} NULL`);
  console.log(`  Made ${table}.${col} nullable`);
}

console.log('Running migrations...');
await makeNullable('pos_eod_reconciliations', 'cashier_id', 'INT');
await addColIfMissing('pos_sales', 'cashier_name', 'VARCHAR(255) NULL AFTER cashier_id');
await addColIfMissing('pos_eod_reconciliations', 'cashier_name', 'VARCHAR(255) NULL AFTER cashier_id');
console.log('Done.');

await conn.end();
