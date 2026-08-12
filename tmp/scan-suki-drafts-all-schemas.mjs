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
    multipleStatements: false,
  });

  const [bizRows] = await conn.execute(
    'SELECT business_id, ims_db_name FROM businesses WHERE deleted_at IS NULL AND ims_db_name IS NOT NULL AND ims_db_name <> "" ORDER BY business_id'
  );

  const schemas = [...new Set(bizRows.map((r) => r.ims_db_name).filter(Boolean))];
  const supplierNeedle = '%SUKI MCMASTER PTY LTD%';

  const sukiRows = [];
  const recentDraftRows = [];

  for (const schema of schemas) {
    try {
      const sukiSql = `
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
          po.location_id
        FROM ${schema}.ims_purchase_orders po
        LEFT JOIN ${schema}.ims_contacts c ON c.id = po.supplier_id
        WHERE UPPER(COALESCE(c.name, po.supplier_name_raw, '')) LIKE UPPER(?)
        ORDER BY po.created_at DESC
        LIMIT 100
      `;
      const [sRows] = await conn.execute(sukiSql, [schema, supplierNeedle]);
      for (const row of sRows) sukiRows.push(row);

      const draftSql = `
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
          po.location_id,
          l.name AS location_name
        FROM ${schema}.ims_purchase_orders po
        LEFT JOIN ${schema}.ims_contacts c ON c.id = po.supplier_id
        LEFT JOIN ${schema}.ims_locations l ON l.id = po.location_id
        WHERE po.status = 'draft' AND po.created_at >= (UTC_TIMESTAMP() - INTERVAL 3 DAY)
        ORDER BY po.created_at DESC
        LIMIT 200
      `;
      const [dRows] = await conn.execute(draftSql, [schema]);
      for (const row of dRows) recentDraftRows.push(row);
    } catch (err) {
      // Ignore schemas that do not have IMS tables yet.
    }
  }

  const sukiDrafts = sukiRows.filter((r) => String(r.status) === 'draft');

  console.log(JSON.stringify({
    checkedSchemas: schemas.length,
    sukiTotal: sukiRows.length,
    sukiDraftsCount: sukiDrafts.length,
    sukiDrafts,
    recentDraftsLast3DaysCount: recentDraftRows.length,
    recentDraftsLast3Days: recentDraftRows,
  }, null, 2));

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
