/**
 * Migration: make ims_sales_order_items.variant_id nullable,
 * drop the FK constraint, and add code/name columns.
 *
 * This allows historical SO line items to be stored even when the
 * Cin7 product has since been deleted (no variant match in IMS).
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     +(process.env.MYSQL_PORT || 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

console.log('Connected to', process.env.IMS_MYSQL_DATABASE);

// Find the FK constraint name on ims_sales_order_items.variant_id
const [fkRows] = await conn.execute(`
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA   = ?
    AND TABLE_NAME     = 'ims_sales_order_items'
    AND COLUMN_NAME    = 'variant_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
`, [process.env.IMS_MYSQL_DATABASE]);

if (fkRows.length > 0) {
  for (const row of fkRows) {
    console.log(`Dropping FK: ${row.CONSTRAINT_NAME}`);
    await conn.execute(`ALTER TABLE ims_sales_order_items DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
  }
} else {
  console.log('No FK found on variant_id (already dropped or never existed)');
}

// Make variant_id nullable
await conn.execute(`
  ALTER TABLE ims_sales_order_items
  MODIFY COLUMN variant_id VARCHAR(36) NULL
`);
console.log('✓ variant_id is now nullable');

// Add code and name columns if they don't exist
const [existingCols] = await conn.execute(`
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_sales_order_items'
`, [process.env.IMS_MYSQL_DATABASE]);
const colNames = new Set(existingCols.map(r => r.COLUMN_NAME));

if (!colNames.has('code')) {
  await conn.execute(`ALTER TABLE ims_sales_order_items ADD COLUMN code VARCHAR(100) NULL AFTER variant_id`);
  console.log('✓ code column added');
} else {
  console.log('  code column already exists');
}

if (!colNames.has('name')) {
  await conn.execute(`ALTER TABLE ims_sales_order_items ADD COLUMN name VARCHAR(500) NULL AFTER code`);
  console.log('✓ name column added');
} else {
  console.log('  name column already exists');
}

await conn.end();
console.log('Done.');
