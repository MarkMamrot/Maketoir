/**
 * Creates and verifies the sales-channel control plane in the main database.
 * Dry-run: node scripts/setup-sales-channels-main.mjs
 * Apply:   node scripts/setup-sales-channels-main.mjs --apply
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');

const tableContracts = {
  sales_channel_instances: {
    columns: ['channel_instance_id', 'business_id', 'provider', 'display_name', 'external_account_key',
      'singleton_key', 'is_enabled', 'runtime_status', 'readiness_status', 'settings_json', 'last_sync_at',
      'last_checkpoint_json', 'safe_error', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_sales_channel_external_account', 'uq_sales_channel_singleton',
      'idx_sales_channel_business', 'idx_sales_channel_runtime'],
  },
  sales_channel_credentials: {
    columns: ['id', 'channel_instance_id', 'credential_type', 'encrypted_payload', 'expires_at',
      'last_rotated_at', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_sales_channel_credential', 'idx_sales_channel_credential_expiry'],
  },
  sales_channel_webhooks: {
    columns: ['id', 'channel_instance_id', 'topic', 'provider_registration_id', 'encrypted_secret',
      'registration_status', 'last_verified_at', 'safe_error', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_sales_channel_webhook', 'idx_sales_channel_webhook_status'],
  },
  sales_channel_business_roles: {
    columns: ['business_id', 'role_key', 'channel_instance_id', 'updated_by_user_id', 'updated_by_name', 'updated_at'],
    indexes: ['PRIMARY', 'idx_sales_channel_role_instance'],
  },
};

function extractDefinition(schema, table) {
  const expression = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  const match = schema.match(expression);
  if (!match) throw new Error(`Canonical definition not found for ${table}.`);
  return match[0];
}

const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const definitions = Object.fromEntries(Object.keys(tableContracts).map(table => [table, extractDefinition(schema, table)]));
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

try {
  const tables = Object.keys(tableContracts);
  const [existingRows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, tables],
  );
  const existing = new Set(existingRows.map(row => row.TABLE_NAME));
  const pending = tables.filter(table => !existing.has(table));
  console.log(`Sales channel main-schema plan for ${database}:`);
  console.log(`  tables to create: ${pending.join(', ') || 'none'}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
  } else {
    for (const definition of Object.values(definitions)) await connection.query(definition);
    console.log('Sales channel main schema applied successfully.');
  }

  if (apply || pending.length === 0) {
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, tables],
    );
    const [indexRows] = await connection.query(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, tables],
    );
    const columns = new Set(columnRows.map(row => `${row.TABLE_NAME}:${row.COLUMN_NAME}`));
    const indexes = new Set(indexRows.map(row => `${row.TABLE_NAME}:${row.INDEX_NAME}`));
    const missingColumns = Object.entries(tableContracts).flatMap(([table, contract]) =>
      contract.columns.filter(column => !columns.has(`${table}:${column}`)).map(column => `${table}.${column}`));
    const missingIndexes = Object.entries(tableContracts).flatMap(([table, contract]) =>
      contract.indexes.filter(index => !indexes.has(`${table}:${index}`)).map(index => `${table}.${index}`));
    if (missingColumns.length || missingIndexes.length) {
      throw new Error(`Sales channel schema verification failed: ${JSON.stringify({ missingColumns, missingIndexes })}`);
    }
    console.log(`Verified ${columns.size} columns and ${indexes.size} indexes across ${tables.length} tables.`);
  }
} finally {
  await connection.end();
}