import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const supplierNeedle = '%SUKI MCMASTER PTY LTD%';

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.IMS_MYSQL_DATABASE,
  });

  const sql = `
    SELECT
      po.id,
      po.po_number,
      po.business_id,
      po.status,
      po.order_date,
      po.expected_date,
      po.created_at,
      po.updated_at,
      po.supplier_id,
      COALESCE(c.name, po.supplier_name_raw) AS supplier_name,
      po.location_id,
      l.name AS location_name
    FROM ims_purchase_orders po
    LEFT JOIN ims_contacts c ON c.id = po.supplier_id
    LEFT JOIN ims_locations l ON l.id = po.location_id
    WHERE UPPER(COALESCE(c.name, po.supplier_name_raw, '')) LIKE UPPER(?)
    ORDER BY po.created_at DESC
    LIMIT 200
  `;

  const [rows] = await conn.execute(sql, [supplierNeedle]);

  console.log(JSON.stringify({
    schema: process.env.IMS_MYSQL_DATABASE,
    count: rows.length,
    rows,
  }, null, 2));

  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
