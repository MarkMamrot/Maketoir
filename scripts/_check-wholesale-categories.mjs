import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     +(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  ssl:      process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Summary counts
const [[summary]] = await conn.execute(`
  SELECT
    COUNT(*) AS total_active,
    SUM(category    IS NOT NULL AND category    != '') AS has_category,
    SUM(subcategory IS NOT NULL AND subcategory != '') AS has_subcategory,
    SUM(product_type IS NOT NULL AND product_type != '') AS has_product_type
  FROM ims_products WHERE is_active = 1
`);
console.log('\n── Product field coverage ──');
console.table(summary);

// Distinct categories
const [cats] = await conn.execute(`
  SELECT category, subcategory, COUNT(*) AS products
  FROM ims_products
  WHERE is_active = 1 AND category IS NOT NULL AND category != ''
  GROUP BY category, subcategory
  ORDER BY category, subcategory
  LIMIT 30
`);
console.log('\n── Distinct category / subcategory combinations ──');
if (cats.length) console.table(cats);
else console.log('  (none)');

// Distinct product types
const [types] = await conn.execute(`
  SELECT product_type, COUNT(*) AS products
  FROM ims_products
  WHERE is_active = 1 AND product_type IS NOT NULL AND product_type != ''
  GROUP BY product_type
  ORDER BY products DESC
  LIMIT 20
`);
console.log('\n── Distinct product_type values ──');
if (types.length) console.table(types);
else console.log('  (none)');

await conn.end();
