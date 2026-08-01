/**
 * setup-xero-tables.mjs
 * Creates the Xero integration tables (account mappings, tracking mappings, sync log).
 * Run: node scripts/setup-xero-tables.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.MYSQL_HOST,
    port:     Number(process.env.MYSQL_PORT || 3306),
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
  });

  console.log('Connected to', process.env.MYSQL_DATABASE);

  const sql = readFileSync(join(__dirname, 'setup-xero-tables.sql'), 'utf8');
  await conn.query(sql);

  const documentPolicyColumns = [
    ['manual_customer_cn_action', "VARCHAR(20) NOT NULL DEFAULT 'authorised' AFTER so_payment_sync_enabled"],
    ['supplier_cn_action', "VARCHAR(20) NOT NULL DEFAULT 'draft' AFTER manual_customer_cn_action"],
    ['pos_batch_sync_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER supplier_cn_action'],
    ['pos_batch_payment_sync_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER pos_batch_sync_enabled'],
    ['online_batch_action', "VARCHAR(20) NOT NULL DEFAULT 'authorised' AFTER pos_batch_payment_sync_enabled"],
    ['online_batch_payment_sync_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER online_batch_action'],
    ['shopify_payout_auto_post_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER online_batch_payment_sync_enabled'],
  ];
  for (const [columnName, definition] of documentPolicyColumns) {
    const [columns] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'xero_document_policies'
          AND COLUMN_NAME = ? LIMIT 1`,
      [columnName],
    );
    if (columns.length === 0) {
      await conn.query(`ALTER TABLE xero_document_policies ADD COLUMN ${columnName} ${definition}`);
    }
  }

  const [gatewayTables] = await conn.query(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'xero_gateway_mappings'
      LIMIT 1`,
  );
  if (gatewayTables.length > 0) {
    const [feeTaxColumns] = await conn.query(
      `SELECT 1
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'xero_gateway_mappings'
          AND COLUMN_NAME = 'fee_tax_type'
        LIMIT 1`,
    );
    if (feeTaxColumns.length === 0) {
      await conn.query(
        `ALTER TABLE xero_gateway_mappings
           ADD COLUMN fee_tax_type VARCHAR(30) NULL
           COMMENT 'Xero tax type for gateway fees, e.g. INPUT or NONE'
           AFTER fee_account_name`,
      );
    }
    const gatewayFeeColumns = [
      ['deduct_fee_enabled', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Post a calculated fee spend for each gross order payment' AFTER fee_tax_type"],
      ['fixed_fee_amount', 'DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER deduct_fee_enabled'],
      ['percentage_fee_rate', "DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT 'Percentage points, e.g. 1.5 means 1.5%' AFTER fixed_fee_amount"],
    ];
    for (const [columnName, definition] of gatewayFeeColumns) {
      const [columns] = await conn.query(
        `SELECT 1
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'xero_gateway_mappings'
            AND COLUMN_NAME = ?
          LIMIT 1`,
        [columnName],
      );
      if (columns.length === 0) {
        await conn.query(`ALTER TABLE xero_gateway_mappings ADD COLUMN ${columnName} ${definition}`);
      }
    }
  }

  const actionColumns = [
    ['action_date', "DATE NULL AFTER target_xero_document_id"],
    ['account_code', "VARCHAR(50) NULL COMMENT 'Shopify clearing account' AFTER currency"],
    ['offset_account_code', "VARCHAR(50) NULL COMMENT 'Expense account for bank transactions' AFTER account_code"],
    ['tax_type', "VARCHAR(30) NULL AFTER offset_account_code"],
    ['reference', "VARCHAR(255) NULL AFTER tax_type"],
  ];
  for (const [columnName, definition] of actionColumns) {
    const [columns] = await conn.query(
      `SELECT 1
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'shopify_payment_xero_actions'
          AND COLUMN_NAME = ?
        LIMIT 1`,
      [columnName],
    );
    if (columns.length === 0) {
      await conn.query(`ALTER TABLE shopify_payment_xero_actions ADD COLUMN ${columnName} ${definition}`);
    }
  }

  console.log('✔ xero_account_mappings created');
  console.log('✔ xero_document_policies created/updated');
  console.log('✔ xero_tracking_mappings created');
  console.log('✔ xero_sync_log created');
  console.log('✔ xero_cogs_settings created');
  console.log('✔ xero_cogs_journal_runs created');
  console.log('✔ xero_pos_payment_mappings created');
  console.log('✔ xero_pos_clearing_mappings created');
  console.log('✔ xero_pos_cash_eod_actions created');
  console.log('✔ xero_cash_deposit_settings created');
  console.log('✔ xero_cash_deposits created');
  console.log('✔ xero_cash_deposit_days created');
  console.log('✔ xero_cash_deposit_sources created');
  console.log('✔ xero_cash_deposit_actions created');
  console.log('✔ xero_online_batches created');
  console.log('✔ xero_online_order_payments created');
  console.log('✔ xero_online_order_fees created');
  console.log('✔ shopify_payment_payouts created');
  console.log('✔ shopify_payment_payout_transactions created');
  console.log('✔ shopify_payment_xero_actions created');
  console.log('✔ xero_gateway_mappings fee tax configuration checked');

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
