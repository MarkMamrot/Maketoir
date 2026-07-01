import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.IMS_MYSQL_DATABASE,
});

const [[{ cnt }]] = await conn.query('SELECT COUNT(*) as cnt FROM ims_product_images');
console.log('Total images:', cnt);

if (Number(cnt) > 0) {
  const [sample] = await conn.query('SELECT id, product_id, SUBSTRING(url,1,100) as url, source, is_primary FROM ims_product_images LIMIT 5');
  console.log('Sample rows:', JSON.stringify(sample, null, 2));

  // Test subquery matching
  const [test] = await conn.query(`
    SELECT p.product_id, p.name,
      (SELECT url FROM ims_product_images WHERE product_id = p.product_id COLLATE utf8mb4_general_ci ORDER BY is_primary DESC, sort_order ASC LIMIT 1) AS img
    FROM ims_products p
    WHERE EXISTS (SELECT 1 FROM ims_product_images WHERE product_id = p.product_id COLLATE utf8mb4_general_ci)
    LIMIT 5
  `);
  console.log('Subquery test (products with images):', JSON.stringify(test, null, 2));
} else {
  console.log('No images in table. Checking what Shopify products look like...');
  const [linked] = await conn.query(`
    SELECT p.product_id, p.name, p.shopify_product_id
    FROM ims_products p
    WHERE p.shopify_product_id IS NOT NULL
    LIMIT 5
  `);
  console.log('Products with Shopify IDs:', JSON.stringify(linked, null, 2));
}

await conn.end();
