import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// Check timestamps + cin7_product_id for known dup SKUs
const [rows] = await db.execute(`
  SELECT v.variant_id, v.sku, v.cin7_option_id, v.created_at, v.updated_at,
         p.cin7_product_id, p.name AS prod_name
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.sku IN ('cMTGB0000','cND-0010','MT-TM0893','cCJ-WN0007')
  ORDER BY v.sku, v.created_at
`);
rows.forEach(r => console.log(
  r.sku, '|', r.cin7_option_id, '| cin7_prod:', r.cin7_product_id,
  '| created:', r.created_at, '| updated:', r.updated_at
));

// How many distinct cin7_product_ids map to the dup cin7_option_ids?
const [prods] = await db.execute(`
  SELECT v.cin7_option_id, COUNT(DISTINCT p.cin7_product_id) AS prod_count,
         GROUP_CONCAT(DISTINCT p.cin7_product_id) AS product_ids,
         GROUP_CONCAT(DISTINCT p.name ORDER BY p.cin7_product_id) AS prod_names
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.sku IN ('cMTGB0000','cND-0010','MT-TM0893')
  GROUP BY v.cin7_option_id
`);
console.log('\nCin7 products per dup option_id:');
prods.forEach(r => console.log(' cin7_option_id:', r.cin7_option_id, '| products:', r.prod_count, '| ids:', r.product_ids, '| names:', r.prod_names));

await db.end();
