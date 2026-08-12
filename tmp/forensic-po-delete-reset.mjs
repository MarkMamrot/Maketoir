import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function querySafe(conn, sql, params = []) {
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } catch (err) {
    return { __error: String(err?.message || err) };
  }
}

async function main() {
  const cfg = {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  };

  const mainDb = process.env.MYSQL_DATABASE;
  const imsDb = process.env.IMS_MYSQL_DATABASE;
  const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

  const connMain = await mysql.createConnection({ ...cfg, database: mainDb });
  const connIms = await mysql.createConnection({ ...cfg, database: imsDb });

  // 1) Runtime issues possibly related to PO delete/reset
  const runtimeIssues = await querySafe(
    connMain,
    `SELECT id, business_id, source, operation, severity, status, title, message,
            source_reference_type, source_reference_id, first_seen_at, last_seen_at, occurrence_count
     FROM runtime_issues
     WHERE (business_id = ? OR business_id IS NULL)
       AND (
         source IN ('ims_purchase_orders', 'ims_data_reset')
         OR operation LIKE '%delete%'
         OR operation LIKE '%reset%'
         OR title LIKE '%purchase order%'
         OR title LIKE '%data reset%'
         OR message LIKE '%purchase order%'
         OR message LIKE '%data reset%'
       )
     ORDER BY last_seen_at DESC
     LIMIT 200`,
    [businessId],
  );

  const issueIds = Array.isArray(runtimeIssues) ? runtimeIssues.map((r) => r.id) : [];

  let runtimeIssueEvents = [];
  if (issueIds.length > 0) {
    const placeholders = issueIds.map(() => '?').join(',');
    runtimeIssueEvents = await querySafe(
      connMain,
      `SELECT issue_id, event_type, severity, message, created_at
       FROM runtime_issue_events
       WHERE issue_id IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 500`,
      issueIds,
    );
  }

  // 2) Data-reset route failures/success traces (if captured as runtime issues)
  const dataResetIssues = await querySafe(
    connMain,
    `SELECT id, business_id, source, operation, severity, status, title, message,
            source_reference_type, source_reference_id, first_seen_at, last_seen_at
     FROM runtime_issues
     WHERE (business_id = ? OR business_id IS NULL)
       AND (source LIKE '%data-reset%' OR operation LIKE '%data-reset%' OR title LIKE '%reset%' OR message LIKE '%reset%')
     ORDER BY last_seen_at DESC
     LIMIT 200`,
    [businessId],
  );

  // 3) IMS operation ledgers around purchase orders (last 7 days)
  const amendmentOpsCols = await querySafe(connIms, 'SHOW COLUMNS FROM ims_order_amendment_operations');
  const amendmentOps = await querySafe(
    connIms,
    `SELECT id, business_id, operation_key, order_kind, order_id, order_status, state,
            actor_user_id, actor_name, created_at, completed_at
     FROM ims_order_amendment_operations
     WHERE business_id = ?
       AND order_kind = 'purchase_order'
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)
     ORDER BY created_at DESC
     LIMIT 300`,
    [businessId],
  );

  const poReceiveOpsCols = await querySafe(connIms, 'SHOW COLUMNS FROM ims_po_receive_operations');
  const poReceiveOps = await querySafe(
    connIms,
    `SELECT id, business_id, operation_key, po_id, state, actor_user_id, actor_name, created_at, completed_at
     FROM ims_po_receive_operations
     WHERE business_id = ?
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)
     ORDER BY created_at DESC
     LIMIT 300`,
    [businessId],
  );

  // 4) Direct proof of current drafts (if any) + very recent deletable candidates not possible after delete
  const currentDrafts = await querySafe(
    connIms,
    `SELECT id, po_number, status, business_id, supplier_id, location_id, created_at, updated_at
     FROM ims_purchase_orders
     WHERE business_id = ? AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 200`,
    [businessId],
  );

  console.log(JSON.stringify({
    mainDb,
    imsDb,
    businessId,
    runtimeIssues,
    runtimeIssueEvents,
    dataResetIssues,
    amendmentOpsCols,
    amendmentOps,
    poReceiveOpsCols,
    poReceiveOps,
    currentDrafts,
  }, null, 2));

  await connMain.end();
  await connIms.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
