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
console.log('location:', firstLoc.name, 'id:', lid);

// Test COUNT with subquery via execute
try {
  const [r] = await pool.execute(
    'SELECT COUNT(*) AS total FROM (SELECT p.product_id FROM ims_products p LEFT JOIN ims_stock s ON s.location_id=? WHERE p.is_active=1 GROUP BY p.product_id) _c',
    [lid]
  );
  console.log('COUNT execute OK:', r[0].total);
} catch(e){ console.error('COUNT execute FAIL:', e.message); }

// Test page query via execute  
try {
  const [r] = await pool.execute(
    'SELECT p.product_id,p.name,COALESCE(MIN(s.min_qty),0) AS min_qty FROM ims_products p LEFT JOIN ims_product_variants v ON v.product_id=p.product_id AND v.is_active=1 LEFT JOIN ims_stock s ON s.variant_id=v.variant_id AND s.location_id=? WHERE p.is_active=1 GROUP BY p.product_id,p.name,p.brand,p.zone,p.bin,p.supplier_contact_id,p.created_at ORDER BY p.created_at DESC LIMIT ? OFFSET ?',
    [lid, 3, 0]
  );
  console.log('PAGE execute OK:', r.map(x=>x.name));
} catch(e){ console.error('PAGE execute FAIL:', e.message); }

// Check ims_stock columns
try {
  const [r] = await pool.execute('SHOW COLUMNS FROM ims_stock');
  const cols = r.map(c=>c.Field);
  console.log('ims_stock zone:', cols.includes('zone'), 'bin:', cols.includes('bin'));
} catch(e){ console.error('SHOW COLUMNS fail:', e.message); }

await pool.end();
