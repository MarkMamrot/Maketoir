import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectTimeout: 10000,
});

const [rows] = await pool.execute(`
  SELECT
    COUNT(*) as total_variants,
    SUM(CHAR_LENGTH(COALESCE(p.description, ''))) as total_desc_chars,
    AVG(CHAR_LENGTH(COALESCE(p.description, ''))) as avg_desc_chars,
    MAX(CHAR_LENGTH(COALESCE(p.description, ''))) as max_desc_chars,
    SUM(CHAR_LENGTH(COALESCE(v.sku,'')))
      + SUM(CHAR_LENGTH(COALESCE(p.name,'')))
      + SUM(CHAR_LENGTH(COALESCE(v.barcode,''))) as name_sku_chars
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.is_active=1 AND p.is_active=1
`);

const r = rows[0];
console.log('Total variants (active):', r.total_variants);
console.log('Avg description length:', Math.round(r.avg_desc_chars), 'chars');
console.log('Max description length:', r.max_desc_chars, 'chars');
console.log('Total description chars:', r.total_desc_chars);
console.log('Total name/sku chars:   ', r.name_sku_chars);

// Rough estimate: each variant in the cache has ~200 bytes of JSON overhead (fields, JSON formatting)
// plus description chars
const overhead = r.total_variants * 200;
const total = parseInt(r.total_desc_chars || 0) + parseInt(r.name_sku_chars || 0) + overhead;
console.log('\nEstimated localStorage cache size: ~', Math.round(total / 1024), 'KB  /', Math.round(total / 1024 / 1024 * 10) / 10, 'MB');
console.log('localStorage typical limit: 5–10 MB');
if (total > 4 * 1024 * 1024) {
  console.log('\n⚠️  Cache likely exceeds localStorage quota — this would cause saveProductsCache() to throw!');
} else {
  console.log('\n✓  Cache size looks safe');
}

await pool.end();
