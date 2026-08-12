import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.IMS_MYSQL_DATABASE,
  });

  const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

  const [amendmentOps] = await conn.execute(
    `SELECT id, business_id, operation_key, order_kind, order_id, order_status, state,
            actor_id, actor_name, created_at, completed_at,
            JSON_EXTRACT(before_header_json, '$.status') AS before_status,
            JSON_EXTRACT(after_header_json, '$.status') AS after_status
     FROM ims_order_amendment_operations
     WHERE business_id = ?
       AND order_kind = 'purchase_order'
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)
     ORDER BY created_at DESC
     LIMIT 500`,
    [businessId],
  );

  const [receiveOps] = await conn.execute(
    `SELECT id, business_id, operation_key, po_id, status, created_at, completed_at,
            JSON_EXTRACT(request_json, '$.mark_po_received') AS mark_po_received,
            JSON_EXTRACT(request_json, '$.create_backorder_po') AS create_backorder_po
     FROM ims_po_receive_operations
     WHERE business_id = ?
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)
     ORDER BY created_at DESC
     LIMIT 500`,
    [businessId],
  );

  const poIds = [...new Set([
    ...amendmentOps.map((r) => Number(r.order_id)).filter(Boolean),
    ...receiveOps.map((r) => Number(r.po_id)).filter(Boolean),
  ])];

  let poSnapshot = [];
  if (poIds.length > 0) {
    const placeholders = poIds.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT id, po_number, status, created_at, updated_at, supplier_id, location_id
       FROM ims_purchase_orders
       WHERE id IN (${placeholders})
       ORDER BY id DESC`,
      poIds,
    );
    poSnapshot = rows;
  }

  console.log(JSON.stringify({
    businessId,
    amendmentOpsCount: amendmentOps.length,
    amendmentOps,
    receiveOpsCount: receiveOps.length,
    receiveOps,
    referencedPoSnapshotCount: poSnapshot.length,
    referencedPoSnapshot: poSnapshot,
  }, null, 2));

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
