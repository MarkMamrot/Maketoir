import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE
});

console.log('Testing sales query...');
try {
  const [rows] = await conn.query(`
    SELECT variant_id,
      SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN qty ELSE 0 END) AS sales_qty_7d,
      SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN qty ELSE 0 END) AS sales_qty_90d,
      SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN qty ELSE 0 END) AS sales_qty_180d,
      SUM(qty) AS sales_qty_12m
    FROM (
      SELECT soi.variant_id, so.order_date AS sale_date, soi.qty_fulfilled AS qty
      FROM   ims_sales_order_items soi
      JOIN   ims_sales_orders      so  ON so.id = soi.so_id
      WHERE  so.status = 'fulfilled'
        AND  so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
      UNION ALL
      SELECT psi.variant_id, DATE(ps.completed_at) AS sale_date, psi.qty AS qty
      FROM   pos_sale_items psi
      JOIN   pos_sales      ps  ON ps.id = psi.sale_id
      WHERE  ps.status    = 'completed'
        AND  ps.sale_type = 'sale'
        AND  ps.completed_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
        AND  psi.variant_id IS NOT NULL
    ) all_sales
    GROUP BY variant_id
    LIMIT 5
  `);
  console.log('Sales query OK:', rows.length, 'rows sample:', JSON.stringify(rows.slice(0, 2)));
} catch (e) {
  console.error('Sales query FAILED:', e.message, 'CODE:', e.code);
}

console.log('\nTesting stock query...');
try {
  const [rows] = await conn.query(`
    SELECT variant_id, SUM(qty_on_hand) AS global_soh, SUM(qty_on_hand - qty_committed) AS global_available, SUM(qty_incoming) AS global_incoming
    FROM ims_stock GROUP BY variant_id LIMIT 5
  `);
  console.log('Stock query OK:', rows.length, 'rows');
} catch (e) {
  console.error('Stock query FAILED:', e.message, 'CODE:', e.code);
}

console.log('\nTesting INSERT into ims_sales_cache...');
try {
  // Test a single row upsert
  await conn.query(`
    INSERT INTO ims_sales_cache
      (variant_id, sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
       global_soh, global_available, global_incoming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sales_qty_7d     = VALUES(sales_qty_7d),
      sales_qty_90d    = VALUES(sales_qty_90d),
      sales_qty_180d   = VALUES(sales_qty_180d),
      sales_qty_12m    = VALUES(sales_qty_12m),
      global_soh       = VALUES(global_soh),
      global_available = VALUES(global_available),
      global_incoming  = VALUES(global_incoming),
      updated_at       = NOW()
  `, ['test-variant-id-0000', 0, 0, 0, 0, 0, 0, 0]);
  console.log('INSERT test OK — deleting test row...');
  await conn.query("DELETE FROM ims_sales_cache WHERE variant_id = 'test-variant-id-0000'");
  console.log('Cleanup OK');
} catch (e) {
  console.error('INSERT FAILED:', e.message, 'CODE:', e.code);
}

await conn.end();
console.log('\nDone.');
