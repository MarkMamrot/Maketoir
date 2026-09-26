import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [businesses] = await connection.query(
    `SELECT business_id, name, ims_db_name FROM businesses
      WHERE deleted_at IS NULL AND ims_db_name IS NOT NULL`,
  );
  for (const business of businesses) {
    if (!/^[A-Za-z0-9_]+$/.test(business.ims_db_name)) continue;
    const [rows] = await connection.query(
      `SELECT log.id AS log_id, log.sync_type, log.reference_id, log.xero_id,
              log.status, log.xero_state, log.detail, log.created_at,
              sales_order.so_number, sales_order.so_type, sales_order.sales_channel,
              sales_order.order_date, sales_order.total_amount
         FROM xero_sync_log log
         LEFT JOIN \`${business.ims_db_name}\`.ims_sales_orders sales_order
           ON log.sync_type = 'so_invoice'
          AND BINARY sales_order.business_id = BINARY log.business_id
          AND sales_order.id = log.reference_id
        WHERE BINARY log.business_id = BINARY ?
          AND log.created_at >= DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL 21 DAY)
          AND log.sync_type IN ('so_invoice', 'online_batch')
        ORDER BY log.created_at, log.id`,
      [business.business_id],
    );
    const individualOnlineLogs = rows.filter(row => row.sync_type === 'so_invoice' && row.so_type === 'online');
    const batchLogs = rows.filter(row => row.sync_type === 'online_batch');
    const uniqueBy = (items, key) => [...new Map(items.map(item => [key(item), item])).values()];
    const individualOnline = uniqueBy(individualOnlineLogs, row => `${row.reference_id}:${row.xero_id ?? 'none'}`);
    const batches = uniqueBy(batchLogs, row => row.xero_id ?? `log:${row.log_id}`);
    if (!individualOnline.length && !batches.length) continue;
    const byDate = new Map();
    for (const row of individualOnline) {
      const date = new Date(row.order_date).toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? { date, individualInvoices: 0, individualTotal: 0, dailyBatches: 0 };
      entry.individualInvoices += 1;
      entry.individualTotal += Number(row.total_amount ?? 0);
      byDate.set(date, entry);
    }
    for (const row of batches) {
      const match = String(row.detail ?? '').match(/online batch [^ ]+ (\d{4}-\d{2}-\d{2})/i);
      const date = match?.[1] ?? new Date(row.created_at).toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? { date, individualInvoices: 0, individualTotal: 0, dailyBatches: 0 };
      entry.dailyBatches += 1;
      byDate.set(date, entry);
    }
    console.log(JSON.stringify({
      business: business.name,
      individualOnlineCount: individualOnline.length,
      individualOnlineLogCount: individualOnlineLogs.length,
      onlineBatchCount: batches.length,
      firstIndividualOnlineAt: individualOnline[0]?.created_at ?? null,
      lastIndividualOnlineAt: individualOnline.at(-1)?.created_at ?? null,
      days: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    }, null, 2));
  }
} finally {
  await connection.end();
}
