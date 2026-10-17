import fs from 'node:fs/promises';

export const ONLINE_SYNC_TENANT_TABLES = [
  'ims_online_sync_control',
  'ims_shopify_reconciliation',
  'ims_shopify_order_recovery',
  'ims_online_day_changes',
];

export const ONLINE_SYNC_JOB_COLUMNS = {
  lease_token: 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  lease_expires_at: 'DATETIME(3) NULL',
};

export const ONLINE_SYNC_ORDER_COLUMNS = {
  lease_token: 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  lease_expires_at: 'DATETIME(3) NULL',
};

export const ONLINE_SYNC_CONTROL_COLUMNS = {
  last_run_at: 'DATETIME(3) NULL',
};

export const ONLINE_SYNC_BATCH_COLUMNS = {
  sync_status: "VARCHAR(20) NOT NULL DEFAULT 'pending'",
  sync_lease_token: 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  sync_lease_expires_at: 'DATETIME(3) NULL',
  sync_available_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
  sync_attempts: 'INT NOT NULL DEFAULT 0',
  sync_required_through: 'DATETIME(3) NULL',
  sync_input_hash: 'CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  sync_input_json: 'JSON NULL',
  sync_stages_json: 'JSON NULL',
  sync_source_generation: 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  sync_review_reason: 'VARCHAR(64) NULL',
  sync_safe_error_code: 'VARCHAR(64) NULL',
};

export function onlineSyncTableDdl(sql, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid online sync table identifier.');
  const ddl = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4(?: COLLATE=utf8mb4_unicode_ci)?;`))?.[0];
  if (!ddl) throw new Error(`Missing canonical online sync table ${table}.`);
  return ddl;
}

async function addColumns(connection, table, definitions) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  if (!rows.length) throw new Error(`Online sync migration requires existing table ${table}.`);
  const present = new Set(rows.map(row => row.COLUMN_NAME));
  for (const [name, definition] of Object.entries(definitions)) {
    if (!present.has(name)) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
  }
}

export async function installOnlineSyncTenantSchema(connection) {
  const sql = await fs.readFile(new URL('./ims-schema.sql', import.meta.url), 'utf8');
  await connection.query('SET SESSION lock_wait_timeout = 5');
  for (const table of ONLINE_SYNC_TENANT_TABLES) await connection.query(onlineSyncTableDdl(sql, table));
  await addColumns(connection, 'ims_sales_channel_jobs', ONLINE_SYNC_JOB_COLUMNS);
  await addColumns(connection, 'ims_shopify_order_recovery', ONLINE_SYNC_ORDER_COLUMNS);
  await addColumns(connection, 'ims_online_sync_control', ONLINE_SYNC_CONTROL_COLUMNS);
}

export async function installOnlineSyncMainSchema(connection) {
  await connection.query('SET SESSION lock_wait_timeout = 5');
  await addColumns(connection, 'xero_online_batches', ONLINE_SYNC_BATCH_COLUMNS);
  const [rows] = await connection.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'xero_online_batches'
        AND INDEX_NAME = 'idx_xero_online_sync_due'`,
  );
  if (!rows.length) {
    await connection.query('ALTER TABLE xero_online_batches ADD INDEX idx_xero_online_sync_due (business_id, sync_status, sync_available_at)');
  }
}
