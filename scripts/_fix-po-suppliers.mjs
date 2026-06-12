import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     process.env.MYSQL_PORT,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// For each PO with no supplier_id, infer from the most common supplier across its line items
const [result] = await conn.execute(`
  UPDATE ims_purchase_orders po
  SET po.supplier_id = (
    SELECT prod.supplier_contact_id
    FROM ims_purchase_order_items poi
    JOIN ims_product_variants pv  ON pv.variant_id  = poi.variant_id
    JOIN ims_products prod         ON prod.product_id = pv.product_id
    WHERE poi.po_id = po.id AND prod.supplier_contact_id IS NOT NULL
    GROUP BY prod.supplier_contact_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  )
  WHERE po.supplier_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM ims_purchase_order_items poi2
      JOIN ims_product_variants pv2  ON pv2.variant_id  = poi2.variant_id
      JOIN ims_products prod2         ON prod2.product_id = pv2.product_id
      WHERE poi2.po_id = po.id AND prod2.supplier_contact_id IS NOT NULL
    )
`);
console.log(`Updated: ${result.affectedRows} purchase orders`);

const [sample] = await conn.execute(`
  SELECT po.po_number, po.supplier_id, c.name AS supplier_name
  FROM ims_purchase_orders po
  LEFT JOIN ims_contacts c ON c.id = po.supplier_id
  WHERE po.cin7_order_id IS NOT NULL
  LIMIT 10
`);
console.log('\nSample POs:');
for (const row of sample) console.log(`  ${row.po_number}  →  ${row.supplier_name ?? '(none)'}`);

const [nullCount] = await conn.execute(
  'SELECT COUNT(*) as n FROM ims_purchase_orders WHERE supplier_id IS NULL AND cin7_order_id IS NOT NULL'
);
console.log(`\nStill missing supplier: ${nullCount[0].n}`);
conn.end();
