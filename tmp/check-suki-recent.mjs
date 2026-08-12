import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.IMS_MYSQL_DATABASE,
  });

  const [rows] = await conn.execute(
    `SELECT
       po.id,
       po.po_number,
       po.status,
       po.created_at,
       po.updated_at,
       po.order_date,
       COALESCE(c.name, po.supplier_name_raw) AS supplier_name
     FROM ims_purchase_orders po
     LEFT JOIN ims_contacts c ON c.id = po.supplier_id
     WHERE UPPER(COALESCE(c.name, po.supplier_name_raw, '')) LIKE UPPER(?)
     ORDER BY po.created_at DESC`,
    ['%SUKI%']
  );

  const cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  console.log(JSON.stringify({
    schema: process.env.IMS_MYSQL_DATABASE,
    totalMatchingSuki: rows.length,
    recent14dCount: recent.length,
    recent14dRows: recent,
  }, null, 2));

  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
