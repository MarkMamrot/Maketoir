/**
 * Migration: Rename variant price/cost columns to be self-documenting.
 *   price            -> price_rrp       (inc-tax)
 *   discounted_price -> price_rrp_sale  (inc-tax, sale window)
 *   wholesale_price  -> price_wholesale (ex-tax)
 *   cost             -> cost_aud        (ex-tax, AUD)
 *   cost_foreign_json-> cost_foreign    (ex-tax, JSON)
 *
 * Also upgrades SO item unit_price precision: DECIMAL(12,4) -> DECIMAL(12,6)
 *
 * Usage: node scripts/rename-price-fields.mjs
 * Safe to re-run - checks current column names first.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

// Check which columns currently exist
const [cols] = await conn.execute(
  `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_product_variants'`,
  [process.env.IMS_MYSQL_DATABASE]
);
const existing = new Set(cols.map(c => c.COLUMN_NAME));

const renames = [
  ['price',             'price_rrp',       'DECIMAL(12,2)'],
  ['discounted_price',  'price_rrp_sale',  'DECIMAL(12,2)'],
  ['wholesale_price',   'price_wholesale', 'DECIMAL(10,4)'],
  ['cost',              'cost_aud',        'DECIMAL(12,4)'],
  ['cost_foreign_json', 'cost_foreign',    'TEXT'],
];

for (const [oldName, newName, colType] of renames) {
  if (existing.has(newName)) {
    console.log(`SKIP ${oldName} -> ${newName}  (already renamed)`);
    continue;
  }
  if (!existing.has(oldName)) {
    console.log(`SKIP ${oldName} -> ${newName}  (old column not found)`);
    continue;
  }
  try {
    await conn.execute(
      `ALTER TABLE ims_product_variants CHANGE COLUMN \`${oldName}\` \`${newName}\` ${colType} NULL`
    );
    console.log(`OK   ${oldName} -> ${newName}`);
  } catch (e) {
    console.error(`ERR  ${oldName} -> ${newName} -`, e.message);
  }
}

// Upgrade SO item unit_price to 6dp for high-precision ex-tax storage
try {
  const [soCols] = await conn.execute(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_sales_order_items' AND COLUMN_NAME = 'unit_price'`,
    [process.env.IMS_MYSQL_DATABASE]
  );
  const currentType = soCols[0]?.COLUMN_TYPE ?? '';
  if (currentType.includes('12,4') || currentType.includes('12,2')) {
    await conn.execute(
      `ALTER TABLE ims_sales_order_items MODIFY COLUMN unit_price DECIMAL(12,6) NOT NULL`
    );
    console.log('OK   ims_sales_order_items.unit_price -> DECIMAL(12,6)');
  } else {
    console.log('SKIP ims_sales_order_items.unit_price  (already DECIMAL(12,6) or higher)');
  }
} catch (e) {
  console.error('ERR  ims_sales_order_items.unit_price -', e.message);
}

await conn.end();
console.log('\nDone.');
