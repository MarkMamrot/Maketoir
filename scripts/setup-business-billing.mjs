import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');
const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const ddl = schema.match(/CREATE TABLE IF NOT EXISTS business_billing_months \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
if (!ddl) throw new Error('Canonical business_billing_months definition not found.');
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database,
});
try {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'plan_start_date'`, [database],
  );
  const [tables] = await connection.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_billing_months'`, [database],
  );
  console.log(`Shared main database: plan start date ${columns.length ? 'exists' : 'will be added'}; monthly billing table ${tables.length ? 'exists' : 'will be created'}.`);
  if (!apply) console.log('Dry run only. Re-run with --apply. No tenant IMS schemas, existing dates or payment amounts will be changed.');
  else {
    if (!columns.length) await connection.query('ALTER TABLE businesses ADD COLUMN plan_start_date DATE NULL');
    await connection.query(ddl);
    const [verified] = await connection.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_billing_months'`, [database],
    );
    if (verified.length !== 10) throw new Error(`Expected 10 monthly billing columns, found ${verified.length}.`);
    console.log('Business billing schema is ready. No historical charges or paid statuses were inferred.');
  }
} finally {
  await connection.end();
}
