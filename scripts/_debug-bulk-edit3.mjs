import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT||3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE, timezone:'Z', waitForConnections:true,
});

const [[firstLoc]] = await pool.query('SELECT id,name FROM ims_locations LIMIT 1');
const lid = firstLoc.id;

// PAGE query with inlined LIMIT/OFFSET (the fix)
try {
  const perPage = 5, offset = 0;
  const [r] = await pool.execute(
    `SELECT p.product_id, p.name,
            COALESCE(MIN(s.min_qty),0) AS min_qty,
            COALESCE(MIN(s.reorder_qty),0) AS reorder_qty,
            COUNT(DISTINCT v.variant_id) AS variant_count
       FROM ims_products p
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
       LEFT JOIN ims_product_variants v ON v.product_id=p.product_id AND v.is_active=1
       LEFT JOIN ims_stock s ON s.variant_id=v.variant_id AND s.location_id=?
       WHERE p.is_active=1
       GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, c.name
       ORDER BY p.created_at DESC
       LIMIT ${perPage} OFFSET ${offset}`,
    [lid]
  );
  console.log('PAGE with inlined LIMIT OK - rows:', r.length, '| first:', r[0]?.name);
} catch(e){ console.error('FAIL:', e.message); }

await pool.end();
