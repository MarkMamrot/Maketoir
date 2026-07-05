import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE, ssl: { rejectUnauthorized: false },
});

const [cols] = await conn.execute(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'brand_profile'`,
  [process.env.MYSQL_DATABASE],
);
const existing = new Set(cols.map(c => c.COLUMN_NAME));

if (!existing.has('detailed_brand_aesthetic')) {
  await conn.execute('ALTER TABLE brand_profile ADD COLUMN detailed_brand_aesthetic TEXT NULL AFTER brand_history');
  console.log('✓ Added detailed_brand_aesthetic column');
} else {
  console.log('  detailed_brand_aesthetic already exists');
}
await conn.end();
