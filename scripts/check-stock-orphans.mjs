import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

const [[r1]] = await db.execute('SELECT COUNT(*) c, COALESCE(SUM(qty_on_hand),0) soh FROM ims_stock WHERE location_id=1');
console.log('Raw Newtown rows:', Number(r1.c), ' SOH:', Number(r1.soh));

const [[r2]] = await db.execute(`
  SELECT COUNT(*) c, COALESCE(SUM(s.qty_on_hand),0) soh
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id=s.variant_id
  JOIN ims_products p ON p.product_id=v.product_id
  WHERE s.location_id=1`);
console.log('Joined Newtown rows:', Number(r2.c), ' SOH:', Number(r2.soh));

const [[r3]] = await db.execute(`
  SELECT COUNT(*) c, COALESCE(SUM(s.qty_on_hand),0) soh
  FROM ims_stock s
  LEFT JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1 AND v.variant_id IS NULL`);
console.log('Orphaned (no variant):', Number(r3.c), ' SOH:', Number(r3.soh));

const [[r4]] = await db.execute(`
  SELECT COUNT(*) c, COALESCE(SUM(s.qty_on_hand),0) soh
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1 AND (v.sku IS NULL OR v.sku='')`);
console.log('Null-sku variants:', Number(r4.c), ' SOH:', Number(r4.soh));

// Sample some orphaned rows
const [orphans] = await db.execute(`
  SELECT s.variant_id, s.qty_on_hand
  FROM ims_stock s
  LEFT JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1 AND v.variant_id IS NULL
  LIMIT 5`);
if (orphans.length > 0) console.log('Sample orphans:', JSON.stringify(orphans));

await db.end();
