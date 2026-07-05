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
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'brand_assets'`,
  [process.env.MYSQL_DATABASE],
);
const existing = new Set(cols.map(c => c.COLUMN_NAME));

if (!existing.has('image_data')) {
  await conn.execute('ALTER TABLE brand_assets ADD COLUMN image_data MEDIUMTEXT NULL AFTER notes');
  console.log('✓ Added image_data column');
} else { console.log('  image_data already exists'); }

if (!existing.has('image_mime')) {
  await conn.execute('ALTER TABLE brand_assets ADD COLUMN image_mime VARCHAR(50) NULL AFTER image_data');
  console.log('✓ Added image_mime column');
} else { console.log('  image_mime already exists'); }

await conn.end();
