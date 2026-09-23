import 'dotenv/config';
import mysql from 'mysql2/promise';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  dateStrings: true,
});

try {
  const [accounts] = await connection.execute(
    `SELECT role_key, xero_account_code, xero_account_name, xero_account_id
       FROM xero_account_mappings
      WHERE business_id = ?
        AND role_key IN ('sales_revenue', 'credit_note', 'freight', 'rounding', 'gift_card_liability', 'store_credit_liability')
      ORDER BY role_key`,
    [businessId],
  );
  const [gateways] = await connection.execute(
    `SELECT gateway_name, display_name, clearing_account_code, clearing_account_name,
            fee_account_code, fee_account_name, fee_tax_type,
            deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate
       FROM xero_gateway_mappings
      WHERE business_id = ?
      ORDER BY gateway_name`,
    [businessId],
  );
  const [tracking] = await connection.execute(
    `SELECT ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id
       FROM xero_tracking_mappings
      WHERE business_id = ? AND (ims_channel = 'online' OR ims_channel IS NULL)
      ORDER BY ims_channel, ims_location_id`,
    [businessId],
  );
  const [policy] = await connection.execute(
    `SELECT online_batch_action, online_batch_payment_sync_enabled,
            shopify_refund_cn_enabled, shopify_payout_posting_enabled,
            shopify_payout_auto_post_enabled
       FROM xero_document_policies
      WHERE business_id = ?`,
    [businessId],
  );
  console.log(JSON.stringify({ accounts, gateways, tracking, policy }, null, 2));
} finally {
  await connection.end();
}
