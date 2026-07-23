const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });
  const db = 'readyedu_MonsterthreadsIMS';
  const locationId = 1;
  const [[loc]] = await conn.query(`SELECT business_id FROM \`${db}\`.ims_locations WHERE id = 1 LIMIT 1`);
  const businessId = loc.business_id;
  console.log('businessId:', businessId);

  // Current query (correlated subqueries)
  let start = Date.now();
  const [rows1] = await conn.query(`
    SELECT v.variant_id,
       COALESCE((SELECT SUM(s2.qty_on_hand) FROM \`${db}\`.ims_stock s2 WHERE s2.variant_id = v.variant_id), 0) AS qty_on_hand_all,
       (SELECT url FROM \`${db}\`.ims_product_images WHERE product_id = p.product_id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) AS image_url
     FROM \`${db}\`.ims_product_variants v
     JOIN \`${db}\`.ims_products p ON p.product_id = v.product_id
     LEFT JOIN \`${db}\`.ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
  `, [locationId, businessId]);
  console.log('CURRENT query:', Date.now() - start, 'ms, rows:', rows1.length);

  // Proposed fix (JOIN-based aggregation with ROW_NUMBER)
  start = Date.now();
  const [rows2] = await conn.query(`
    SELECT v.variant_id,
       COALESCE(sall.total_on_hand, 0)   AS qty_on_hand_all,
       pimg.image_url
     FROM \`${db}\`.ims_product_variants v
     JOIN \`${db}\`.ims_products p ON p.product_id = v.product_id
     LEFT JOIN \`${db}\`.ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     LEFT JOIN (
       SELECT variant_id,
              SUM(qty_on_hand) AS total_on_hand,
              SUM(qty_on_hand - COALESCE(qty_committed,0)) AS total_available
       FROM \`${db}\`.ims_stock
       GROUP BY variant_id
     ) sall ON sall.variant_id = v.variant_id
     LEFT JOIN (
       SELECT pi.product_id, pi.url AS image_url,
              ROW_NUMBER() OVER (PARTITION BY pi.product_id ORDER BY pi.is_primary DESC, pi.sort_order ASC) AS rn
       FROM \`${db}\`.ims_product_images pi
     ) pimg ON pimg.product_id = p.product_id AND pimg.rn = 1
     WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
  `, [locationId, businessId]);
  console.log('FIXED query: ', Date.now() - start, 'ms, rows:', rows2.length);

  // Even simpler: no images at all in the main query (fetch separately)
  start = Date.now();
  const [rows3] = await conn.query(`
    SELECT v.variant_id,
       COALESCE(sall.total_on_hand, 0)   AS qty_on_hand_all
     FROM \`${db}\`.ims_product_variants v
     JOIN \`${db}\`.ims_products p ON p.product_id = v.product_id
     LEFT JOIN \`${db}\`.ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     LEFT JOIN (
       SELECT variant_id,
              SUM(qty_on_hand) AS total_on_hand,
              SUM(qty_on_hand - COALESCE(qty_committed,0)) AS total_available
       FROM \`${db}\`.ims_stock
       GROUP BY variant_id
     ) sall ON sall.variant_id = v.variant_id
     WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
  `, [locationId, businessId]);
  console.log('NO-IMAGE query:', Date.now() - start, 'ms, rows:', rows3.length);

  await conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
