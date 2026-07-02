import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// 1. Check BBW25PLATYPUSW across all locations
const [rows] = await conn.execute(`
  SELECT v.sku, l.name AS location, s.qty_on_hand, s.min_qty, s.reorder_qty
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id = s.variant_id
  JOIN ims_locations l ON l.id = s.location_id
  WHERE v.sku = 'BBW25PLATYPUSW'
  ORDER BY l.name
`);
console.log('=== BBW25PLATYPUSW stock rows ===');
console.table(rows);

// 2. Overall SOH distribution
const [counts] = await conn.execute(`
  SELECT
    SUM(qty_on_hand = 0) AS zero_soh_rows,
    SUM(qty_on_hand > 0) AS positive_soh_rows,
    COUNT(*) AS total_stock_rows
  FROM ims_stock
`);
console.log('=== ims_stock SOH distribution ===');
console.table(counts);

// 3. Locations count, active variants, variants with any stock row
const [[locRow]] = await conn.execute('SELECT COUNT(*) AS cnt FROM ims_locations');
const [[varRow]] = await conn.execute('SELECT COUNT(*) AS cnt FROM ims_product_variants WHERE is_active = 1');
const [[stockRow]] = await conn.execute('SELECT COUNT(DISTINCT variant_id) AS cnt FROM ims_stock');
console.log(`Locations: ${locRow.cnt}`);
console.log(`Active variants: ${varRow.cnt}`);
console.log(`Variants with at least 1 stock row: ${stockRow.cnt}`);

// 4. Active variants with NO stock row at all
const [[noRowRow]] = await conn.execute(`
  SELECT COUNT(*) AS cnt
  FROM ims_product_variants v
  WHERE v.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM ims_stock s WHERE s.variant_id = v.variant_id)
`);
console.log(`Active variants with ZERO stock rows at any location: ${noRowRow.cnt}`);

// 5. Variants that have stock rows at fewer locations than the total
const totalLocs = locRow.cnt;
const [partialRows] = await conn.execute(`
  SELECT COUNT(*) AS cnt FROM (
    SELECT v.variant_id
    FROM ims_product_variants v
    JOIN ims_stock s ON s.variant_id = v.variant_id
    WHERE v.is_active = 1
    GROUP BY v.variant_id
    HAVING COUNT(*) < ?
  ) sub
`, [totalLocs]);
console.log(`Active variants with stock rows at SOME but not all ${totalLocs} locations: ${partialRows[0].cnt}`);

await conn.end();
