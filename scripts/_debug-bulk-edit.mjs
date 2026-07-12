import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  timezone: 'Z',
  waitForConnections: true,
});

const [[loc]] = await pool.query('SELECT id, name FROM ims_locations LIMIT 1');
const locationId = loc.id;
console.log('location:', loc.name, 'id:', locationId);

// 1. COUNT via pool.execute (subquery)
try {
  const [r] = await pool.execute(
    `SELECT COUNT(*) AS total FROM (SELECT p.product_id
       FROM ims_products p
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
       LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.is_active = 1
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
       WHERE p.is_active = 1
       GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, c.name
     ) _cnt`,
    [locationId]
  );
  console.log('COUNT via execute OK:', r[0]);
} catch(e) { console.error('COUNT via execute FAILED:', e.message); }

// 2. COUNT via pool.query (client-side)
try {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS total FROM (SELECT p.product_id
       FROM ims_products p LEFT JOIN ims_stock s ON s.variant_id IN (
         SELECT variant_id FROM ims_product_variants WHERE product_id = p.product_id
       ) AND s.location_id = ?
       WHERE p.is_active = 1 GROUP BY p.product_id
     ) _cnt`,
    [locationId]
  );
  console.log('Alternative count via query OK:', r[0]);
} catch(e) { console.error('Alternative count via query FAILED:', e.message); }

// 3. PAGE query via pool.execute
try {
  const [r] = await pool.execute(
    `SELECT p.product_id, p.name, p.brand, p.zone, p.bin,
            p.supplier_contact_id, p.created_at,
            COALESCE(MIN(s.min_qty), 0) AS min_qty,
            COALESCE(MIN(s.reorder_qty), 0) AS reorder_qty,
            COUNT(DISTINCT v.variant_id) AS variant_count
       FROM ims_products p
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
       LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.is_active = 1
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
       WHERE p.is_active = 1
       GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, c.name
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [locationId, 5, 0]
  );
  console.log('PAGE via execute OK, count:', r.length, 'first:', r[0]?.name);
} catch(e) { console.error('PAGE via execute FAILED:', e.message); }

// 4. Check ims_stock zone/bin via execute
try {
  const [r] = await pool.execute('SHOW COLUMNS FROM ims_stock');
  const fields = r.map(c => c.Field);
  console.log('ims_stock has zone:', fields.includes('zone'), '| bin:', fields.includes('bin'));
} catch(e) { console.error('SHOW COLUMNS failed:', e.message); }

await pool.end();


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
