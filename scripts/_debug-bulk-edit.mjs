import 'dotenv/config';
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [[loc]] = await c.query('SELECT id, name FROM ims_locations LIMIT 1');
const locationId = loc.id;
console.log('Testing with location:', loc.name, '(id', locationId, ')');

// 1. Test the count query
try {
  const [rows] = await c.query(`
    SELECT COUNT(*) AS total FROM (
      SELECT p.product_id
      FROM ims_products p
      LEFT JOIN ims_contacts ct ON ct.id = p.supplier_contact_id
      LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.is_active = 1
      LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
      WHERE p.is_active = 1
      GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, ct.name
    ) _cnt`, [locationId]);
  console.log('Count query OK:', rows[0]);
} catch (e) {
  console.error('COUNT QUERY FAILED:', e.message);
}

// 2. Test the page query
try {
  const [rows] = await c.query(`
    SELECT p.product_id, p.name, p.brand, p.zone, p.bin,
           p.supplier_contact_id, ct.name AS supplier_name, p.created_at,
           COALESCE(MIN(s.min_qty), 0) AS min_qty,
           COALESCE(MIN(s.reorder_qty), 0) AS reorder_qty,
           COUNT(DISTINCT v.variant_id) AS variant_count
    FROM ims_products p
    LEFT JOIN ims_contacts ct ON ct.id = p.supplier_contact_id
    LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.is_active = 1
    LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
    WHERE p.is_active = 1
    GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, ct.name
    ORDER BY p.created_at DESC
    LIMIT 5 OFFSET 0`, [locationId]);
  console.log('Page query OK, first 5 products:', rows.map(r => r.name));
} catch (e) {
  console.error('PAGE QUERY FAILED:', e.message);
}

// 3. Check ims_products columns exist
try {
  const [cols] = await c.query("SHOW COLUMNS FROM ims_products LIKE 'zone'");
  console.log('zone column in ims_products:', cols.length ? 'EXISTS' : 'MISSING');
  const [cols2] = await c.query("SHOW COLUMNS FROM ims_products LIKE 'bin'");
  console.log('bin column in ims_products:', cols2.length ? 'EXISTS' : 'MISSING');
} catch (e) {
  console.error('SHOW COLUMNS failed:', e.message);
}

await c.end();
