import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

const [r1] = await c.execute('SELECT COUNT(*) AS total, SUM(supplier_contact_id IS NULL) AS null_count FROM ims_products');
console.log(`Total products: ${r1[0].total}  |  NULL supplier_contact_id: ${r1[0].null_count}`);

const [r2] = await c.execute(`
  SELECT COUNT(*) AS po_products
  FROM (
    SELECT DISTINCT v.product_id
    FROM ims_product_variants v
    JOIN ims_purchase_order_items poi ON poi.variant_id = v.variant_id
  ) x
`);
console.log(`Products appearing on at least one PO: ${r2[0].po_products}`);

const [r3] = await c.execute(`
  SELECT COUNT(*) AS unset_with_po
  FROM ims_products p
  WHERE p.supplier_contact_id IS NULL
    AND EXISTS (
      SELECT 1 FROM ims_product_variants v
      JOIN ims_purchase_order_items poi ON poi.variant_id = v.variant_id
      WHERE v.product_id = p.product_id
    )
`);
console.log(`Products with PO history but NULL supplier_contact_id: ${r3[0].unset_with_po}`);

await c.end();
