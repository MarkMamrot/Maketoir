import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const bizId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const imsDb = 'readyedu_MonsterthreadsIMS';

const [payouts] = await conn.query(
  `SELECT p.shopify_payout_id, DATE_FORMAT(p.payout_date, '%Y-%m-%d') AS payout_date,
          p.shopify_status, p.payout_amount, p.transaction_net_total,
          p.reconciliation_status, p.error_detail,
          JSON_TYPE(p.raw_payload) AS raw_payload_type,
          JSON_LENGTH(p.raw_payload) AS raw_payload_length,
          COUNT(t.id) AS transaction_count,
          COALESCE(SUM(t.amount), 0) AS transaction_amount,
          COALESCE(SUM(t.fee), 0) AS transaction_fee,
          COALESCE(SUM(t.net), 0) AS transaction_net
     FROM shopify_payment_payouts p
     LEFT JOIN shopify_payment_payout_transactions t
       ON t.business_id = p.business_id
      AND t.shopify_payout_id = p.shopify_payout_id
    WHERE p.business_id = ?
    GROUP BY p.id
    ORDER BY p.payout_date DESC, p.id DESC
    LIMIT 20`,
  [bizId],
);
console.log('PAYOUT_SUMMARY', JSON.stringify(payouts, null, 2));

const [transactionTypes] = await conn.query(
  `SELECT shopify_payout_id, transaction_type, COUNT(*) AS transaction_count,
          SUM(amount) AS amount, SUM(fee) AS fee, SUM(net) AS net,
          MIN(processed_at) AS first_processed_at, MAX(processed_at) AS last_processed_at
     FROM shopify_payment_payout_transactions
    WHERE business_id = ?
    GROUP BY shopify_payout_id, transaction_type
    ORDER BY shopify_payout_id DESC, transaction_type`,
  [bizId],
);
console.log('\nPAYOUT_TRANSACTION_TYPES', JSON.stringify(transactionTypes, null, 2));

const [actions] = await conn.query(
  `SELECT shopify_payout_id, action_type, status, target_xero_document_id,
          amount, error_detail, attempt_count, last_attempt_at
     FROM shopify_payment_xero_actions
    WHERE business_id = ?
    ORDER BY shopify_payout_id DESC, id`,
  [bizId],
);
console.log('\nPAYOUT_ACTIONS', JSON.stringify(actions, null, 2));

const [orderCoverage] = await conn.query(
  `SELECT t.shopify_payout_id, COUNT(*) AS charge_count,
          SUM(CASE WHEN so.id IS NULL THEN 1 ELSE 0 END) AS missing_order_count,
          SUM(CASE WHEN so.id IS NOT NULL THEN 1 ELSE 0 END) AS linked_order_count
     FROM shopify_payment_payout_transactions t
     LEFT JOIN ${imsDb}.ims_sales_orders so
       ON CONVERT(so.business_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.business_id
      AND CONVERT(so.shopify_order_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.source_order_id
    WHERE t.business_id = ? AND LOWER(t.transaction_type) IN ('charge', 'payment')
    GROUP BY t.shopify_payout_id
    ORDER BY t.shopify_payout_id DESC`,
  [bizId],
);
console.log('\nPAYOUT_ORDER_COVERAGE', JSON.stringify(orderCoverage, null, 2));

const [payoutDates] = await conn.query(
  `SELECT t.shopify_payout_id,
          MIN(DATE(t.processed_at)) AS first_transaction_date,
          MAX(DATE(t.processed_at)) AS last_transaction_date,
          GROUP_CONCAT(DISTINCT DATE_FORMAT(so.order_date, '%Y-%m-%d') ORDER BY DATE(so.order_date)) AS order_dates,
          COUNT(DISTINCT DATE(so.order_date)) AS order_day_count,
          SUM(CASE WHEN b.xero_invoice_id IS NULL THEN 1 ELSE 0 END) AS charges_without_xero_batch
     FROM shopify_payment_payout_transactions t
     LEFT JOIN ${imsDb}.ims_sales_orders so
       ON CONVERT(so.business_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.business_id
      AND CONVERT(so.shopify_order_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.source_order_id
     LEFT JOIN xero_online_batches b
       ON b.business_id = t.business_id
      AND b.batch_date = DATE(so.order_date)
      AND b.payout_managed = 1
    WHERE t.business_id = ? AND LOWER(t.transaction_type) IN ('charge', 'payment')
    GROUP BY t.shopify_payout_id
    ORDER BY t.shopify_payout_id DESC`,
  [bizId],
);
console.log('\nPAYOUT_DATE_AND_BATCH_COVERAGE', JSON.stringify(payoutDates, null, 2));

const [targetTransactions] = await conn.query(
  `SELECT t.shopify_transaction_id, t.transaction_type, t.amount, t.fee, t.net,
          DATE_FORMAT(t.processed_at, '%Y-%m-%d %H:%i:%s') AS processed_at,
          t.source_order_id,
          DATE_FORMAT(so.order_date, '%Y-%m-%d') AS ims_order_date,
          cn.id AS credit_note_id, cn.status AS credit_note_status,
          cn.xero_credit_note_id
     FROM shopify_payment_payout_transactions t
     LEFT JOIN ${imsDb}.ims_sales_orders so
       ON CONVERT(so.business_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.business_id
      AND CONVERT(so.shopify_order_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.source_order_id
     LEFT JOIN ${imsDb}.ims_credit_notes cn
       ON cn.so_id = so.id
      AND CONVERT(cn.business_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci = t.business_id
      AND cn.source = 'shopify'
    WHERE t.business_id = ? AND t.shopify_payout_id = ?
    ORDER BY t.processed_at, t.shopify_transaction_id`,
  [bizId, '138797744344'],
);
console.log('\nTARGET_PAYOUT_TRANSACTIONS', JSON.stringify(targetTransactions, null, 2));

const [gatewayMappings] = await conn.query(
  `SELECT gateway_name, clearing_account_code, fee_account_code, fee_tax_type
     FROM xero_gateway_mappings
    WHERE business_id = ? AND LOWER(gateway_name) LIKE '%shopify%'`,
  [bizId],
);
console.log('\nSHOPIFY_GATEWAY_MAPPINGS', JSON.stringify(gatewayMappings, null, 2));

const [xsl] = await conn.query(
  `SELECT detail, status, xero_id, created_at FROM xero_sync_log
    WHERE business_id=? AND sync_type='online_batch' ORDER BY created_at DESC`,
  [bizId],
);
console.log('ONLINE_BATCH_SYNC_LOG', JSON.stringify(xsl, null, 2));

const [batches] = await conn.query(
  `SELECT DATE_FORMAT(batch_date, '%Y-%m-%d') AS batch_date, xero_invoice_id, invoice_status, payout_managed
     FROM xero_online_batches WHERE business_id=? ORDER BY batch_date DESC LIMIT 20`,
  [bizId],
);
console.log('\nXERO_ONLINE_BATCHES', JSON.stringify(batches, null, 2));

const [dayRows] = await conn.query(
  `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day, COUNT(*) AS c, CAST(SUM(total_amount) AS DECIMAL(10,2)) AS total
     FROM ${imsDb}.ims_sales_orders
    WHERE so_type='online' AND status NOT IN ('cancelled','draft')
    GROUP BY day ORDER BY day DESC LIMIT 20`,
);
console.log('\nIMS_ONLINE_DAYS', JSON.stringify(dayRows, null, 2));

await conn.end();
