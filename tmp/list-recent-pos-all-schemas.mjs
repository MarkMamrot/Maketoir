import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [bizRows] = await conn.execute(
    'SELECT business_id, ims_db_name FROM businesses WHERE deleted_at IS NULL AND ims_db_name IS NOT NULL AND ims_db_name <> "" ORDER BY business_id'
  );

  const schemas = [...new Set(bizRows.map((r) => r.ims_db_name).filter(Boolean))];
  const recentRows = [];

  for (const schema of schemas) {
    try {
      const sql = `
        SELECT
          ? AS schema_name,
          po.id,
          po.po_number,
          po.business_id,
          po.status,
          po.created_at,
          po.updated_at,
          po.order_date,
          COALESCE(c.name, po.supplier_name_raw) AS supplier_name,
          po.supplier_id,
          po.location_id,
          l.name AS location_name
        FROM ${schema}.ims_purchase_orders po
        LEFT JOIN ${schema}.ims_contacts c ON c.id = po.supplier_id
        LEFT JOIN ${schema}.ims_locations l ON l.id = po.location_id
        WHERE po.created_at >= (UTC_TIMESTAMP() - INTERVAL 2 DAY)
           OR po.updated_at >= (UTC_TIMESTAMP() - INTERVAL 2 DAY)
        ORDER BY po.updated_at DESC
        LIMIT 500
      `;
      const [rows] = await conn.execute(sql, [schema]);
      for (const row of rows) recentRows.push(row);
    } catch {
      // ignore non-provisioned schemas
    }
  }

  console.log(JSON.stringify({ checkedSchemas: schemas.length, recentCount: recentRows.length, recentRows }, null, 2));
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
