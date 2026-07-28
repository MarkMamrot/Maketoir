require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [bizCols] = await conn.query('SHOW COLUMNS FROM businesses');
  const hasId = bizCols.some((c) => c.Field === 'id');
  const hasBusinessId = bizCols.some((c) => c.Field === 'business_id');
  const hasName = bizCols.some((c) => c.Field === 'name');
  const hasCompany = bizCols.some((c) => c.Field === 'company');

  const labelCol = hasName ? 'name' : (hasCompany ? 'company' : null);
  if (!labelCol || (!hasId && !hasBusinessId)) {
    console.log('Unable to identify businesses key/name columns. Columns:', bizCols.map((c) => c.Field).join(', '));
    await conn.end();
    return;
  }

  const keyCol = hasId ? 'id' : 'business_id';
  const [bizRows] = await conn.query(
    `SELECT ${keyCol} AS key_id, ${labelCol} AS biz_name, ims_db_name FROM businesses WHERE LOWER(${labelCol}) LIKE ? ORDER BY ${keyCol} LIMIT 1`,
    ['%monsterthreads%'],
  );

  if (!bizRows.length) {
    console.log('No Monsterthreads business found');
    await conn.end();
    return;
  }

  const biz = bizRows[0];
  console.log('Business:', biz.key_id, biz.biz_name, biz.ims_db_name);
  const imsDb = String(biz.ims_db_name || '').trim();
  if (!imsDb) {
    console.log('Business has no ims_db_name');
    await conn.end();
    return;
  }

  const qvbSalesSql = `
    SELECT COUNT(*) AS sales_count,
           COALESCE(SUM(ps.total), 0) AS total_sales,
           COALESCE(SUM(ps.tax_total), 0) AS total_tax
    FROM ${imsDb}.pos_sales ps
    JOIN ${imsDb}.ims_locations l ON l.id = ps.location_id
    WHERE l.name = 'QVB Shop'
      AND ps.status = 'completed'
      AND DATE(ps.created_at) = CURDATE()`;

  const [sales] = await conn.query(qvbSalesSql);
  console.log('QVB today sales:', sales[0]);

  const qvbCogsSql = `
    SELECT COALESCE(SUM(COALESCE(psi.qty, 0) * COALESCE(pv.avg_cost, pv.cost_aud, 0)), 0) AS total_cogs
    FROM ${imsDb}.pos_sales ps
    JOIN ${imsDb}.ims_locations l ON l.id = ps.location_id
    JOIN ${imsDb}.pos_sale_items psi ON psi.sale_id = ps.id
    LEFT JOIN ${imsDb}.ims_product_variants pv ON pv.variant_id = psi.variant_id
    WHERE l.name = 'QVB Shop'
      AND ps.status = 'completed'
      AND DATE(ps.created_at) = CURDATE()`;

  const [cogs] = await conn.query(qvbCogsSql);
  console.log('QVB today cogs:', cogs[0]);

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
