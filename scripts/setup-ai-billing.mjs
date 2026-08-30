/** Adds the cross-tenant AI usage, pricing, credit, and account control plane. */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
});

const tableNames = ['ai_plans', 'business_ai_accounts', 'ai_provider_rates', 'ai_plan_rates', 'ai_provider_models', 'ai_usage_calls', 'ai_account_ledger'];

const definitions = {
  ai_plans: `CREATE TABLE ai_plans (plan_key VARCHAR(32) PRIMARY KEY, display_name VARCHAR(100) NOT NULL, description VARCHAR(500) NULL, is_internal TINYINT(1) NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1, pricing_mode ENUM('rates','markup') NOT NULL DEFAULT 'rates', markup_basis_points INT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  business_ai_accounts: `CREATE TABLE business_ai_accounts (business_id VARCHAR(100) PRIMARY KEY, plan_key VARCHAR(32) NOT NULL DEFAULT 'starter', funding_mode ENUM('prepaid','account_limit') NOT NULL DEFAULT 'prepaid', enforcement_mode ENUM('observe','enforce','suspended') NOT NULL DEFAULT 'observe', cycle_mode ENUM('billing_anniversary','calendar_month','manual') NOT NULL DEFAULT 'manual', cycle_anchor_day TINYINT UNSIGNED NOT NULL DEFAULT 1, cycle_timezone VARCHAR(100) NOT NULL DEFAULT 'Australia/Sydney', cycle_started_at DATETIME(3) NULL, cycle_ends_at DATETIME(3) NULL, balance_micros BIGINT NOT NULL DEFAULT 0, cycle_limit_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, cycle_used_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, reserved_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, warning_percent TINYINT UNSIGNED NOT NULL DEFAULT 80, version BIGINT UNSIGNED NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX idx_ai_accounts_plan (plan_key), INDEX idx_ai_accounts_cycle_end (cycle_ends_at), INDEX idx_ai_accounts_enforcement (enforcement_mode)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ai_provider_rates: `CREATE TABLE ai_provider_rates (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, provider VARCHAR(32) NOT NULL DEFAULT 'google', model_id VARCHAR(150) NOT NULL, metric ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','input_tokens_over_200k','cached_input_tokens_over_200k','output_tokens_over_200k','thinking_tokens_over_200k','output_image_tokens','output_image','video_second') NOT NULL, price_per_unit_micros BIGINT UNSIGNED NOT NULL, unit_scale INT UNSIGNED NOT NULL DEFAULT 1000000, source_currency CHAR(3) NOT NULL DEFAULT 'USD', source_price_decimal DECIMAL(20,8) NOT NULL, aud_fx_rate DECIMAL(20,8) NOT NULL, source_sku_id VARCHAR(100) NULL, source_price_name VARCHAR(255) NULL, effective_from DATETIME(3) NOT NULL, effective_to DATETIME(3) NULL, created_by INT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_ai_provider_rate (provider, model_id, metric, effective_from), INDEX idx_ai_provider_rate_lookup (provider, model_id, metric, effective_from, effective_to)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ai_plan_rates: `CREATE TABLE ai_plan_rates (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_key VARCHAR(32) NOT NULL, model_id VARCHAR(150) NOT NULL, metric ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','input_tokens_over_200k','cached_input_tokens_over_200k','output_tokens_over_200k','thinking_tokens_over_200k','output_image_tokens','output_image','video_second') NOT NULL, price_per_unit_micros BIGINT UNSIGNED NOT NULL, unit_scale INT UNSIGNED NOT NULL DEFAULT 1000000, effective_from DATETIME(3) NOT NULL, effective_to DATETIME(3) NULL, created_by INT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_ai_plan_rate (plan_key, model_id, metric, effective_from), INDEX idx_ai_plan_rate_lookup (plan_key, model_id, metric, effective_from, effective_to)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ai_provider_models: `CREATE TABLE ai_provider_models (provider VARCHAR(32) NOT NULL DEFAULT 'google', model_id VARCHAR(150) NOT NULL, is_allowed TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (provider, model_id), INDEX idx_ai_provider_models_allowed (provider, is_allowed, model_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ai_usage_calls: `CREATE TABLE ai_usage_calls (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, call_key VARCHAR(191) NOT NULL, parent_call_id BIGINT UNSIGNED NULL, business_id VARCHAR(100) NOT NULL, area VARCHAR(64) NOT NULL, operation VARCHAR(128) NOT NULL, actor_type ENUM('user','cron','webhook','public','system') NOT NULL, actor_user_id INT NULL, model_id VARCHAR(150) NOT NULL, reference_type VARCHAR(64) NULL, reference_id VARCHAR(191) NULL, status ENUM('reserved','submitted','settled','released','unknown','denied') NOT NULL, input_tokens INT UNSIGNED NOT NULL DEFAULT 0, cached_input_tokens INT UNSIGNED NOT NULL DEFAULT 0, output_tokens INT UNSIGNED NOT NULL DEFAULT 0, thinking_tokens INT UNSIGNED NOT NULL DEFAULT 0, output_images INT UNSIGNED NOT NULL DEFAULT 0, video_seconds INT UNSIGNED NOT NULL DEFAULT 0, reserved_charge_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, provider_cost_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, tenant_charge_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, provider_rate_snapshot JSON NULL, plan_rate_snapshot JSON NULL, safe_error VARCHAR(500) NULL, submitted_at DATETIME(3) NULL, settled_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_ai_usage_call_key (call_key), INDEX idx_ai_usage_business_created (business_id, created_at), INDEX idx_ai_usage_area_created (area, created_at), INDEX idx_ai_usage_model_created (model_id, created_at), INDEX idx_ai_usage_status_created (status, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ai_account_ledger: `CREATE TABLE ai_account_ledger (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, idempotency_key VARCHAR(191) NOT NULL, entry_type ENUM('credit_grant','credit_removal','usage_charge','reservation_release','cycle_reset','limit_change','account_change','reconciliation') NOT NULL, amount_micros BIGINT NOT NULL DEFAULT 0, balance_after_micros BIGINT NOT NULL DEFAULT 0, cycle_used_after_micros BIGINT UNSIGNED NOT NULL DEFAULT 0, usage_call_id BIGINT UNSIGNED NULL, reason VARCHAR(100) NOT NULL, notes VARCHAR(500) NULL, external_reference VARCHAR(191) NULL, actor_user_id INT NULL, actor_name VARCHAR(255) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_ai_ledger_idempotency (idempotency_key), INDEX idx_ai_ledger_business_created (business_id, created_at), INDEX idx_ai_ledger_call (usage_call_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

try {
  const [[businessIdColumn]] = await connection.query(`SELECT CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'business_id'`);
  if (!businessIdColumn) throw new Error('businesses.business_id was not found.');
  for (const tableName of tableNames) {
    const [[existing]] = await connection.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
    if (!existing) {
      await connection.query(definitions[tableName]);
      console.log(`Created ${tableName}`);
    } else console.log(`Already present: ${tableName}`);
  }
  for (const tableName of ['business_ai_accounts', 'ai_usage_calls', 'ai_account_ledger']) {
    await connection.query(`ALTER TABLE ${tableName} MODIFY business_id ${businessIdColumn.COLUMN_TYPE} CHARACTER SET ${businessIdColumn.CHARACTER_SET_NAME} COLLATE ${businessIdColumn.COLLATION_NAME} NOT NULL`);
  }
  for (const [columnName, definition] of [
    ['source_sku_id', 'VARCHAR(100) NULL AFTER aud_fx_rate'],
    ['source_price_name', 'VARCHAR(255) NULL AFTER source_sku_id'],
  ]) {
    const [[column]] = await connection.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_provider_rates' AND COLUMN_NAME = ?`, [columnName]);
    if (!column) { await connection.query(`ALTER TABLE ai_provider_rates ADD COLUMN ${columnName} ${definition}`); console.log(`Added ai_provider_rates.${columnName}`); }
  }
  const rateMetricDefinition = `ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','input_tokens_over_200k','cached_input_tokens_over_200k','output_tokens_over_200k','thinking_tokens_over_200k','output_image_tokens','output_image','video_second') NOT NULL`;
  await connection.query(`ALTER TABLE ai_provider_rates MODIFY metric ${rateMetricDefinition}`);
  await connection.query(`ALTER TABLE ai_plan_rates MODIFY metric ${rateMetricDefinition}`);
  for (const [columnName, definition] of [
    ['pricing_mode', `ENUM('rates','markup') NOT NULL DEFAULT 'rates' AFTER is_active`],
    ['markup_basis_points', `INT UNSIGNED NOT NULL DEFAULT 0 AFTER pricing_mode`],
  ]) {
    const [[column]] = await connection.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_plans' AND COLUMN_NAME = ?`, [columnName]);
    if (!column) { await connection.query(`ALTER TABLE ai_plans ADD COLUMN ${columnName} ${definition}`); console.log(`Added ai_plans.${columnName}`); }
  }
  await connection.query(`INSERT IGNORE INTO ai_provider_models (provider,model_id,is_allowed) SELECT provider,model_id,1 FROM ai_provider_rates WHERE effective_to IS NULL GROUP BY provider,model_id`);
  const plans = [
    ['starter', 'Starter', 0], ['core', 'Core', 0], ['scale', 'Scale', 0],
    ['enterprise', 'Enterprise', 0], ['platform', 'Solvantis Platform', 1],
  ];
  for (const [key, name, internal] of plans) {
    await connection.query(`INSERT INTO ai_plans (plan_key, display_name, is_internal) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), is_internal = VALUES(is_internal)`, [key, name, internal]);
  }
  await connection.query(`INSERT IGNORE INTO business_ai_accounts (business_id, plan_key, funding_mode, enforcement_mode, cycle_mode) SELECT business_id, 'starter', 'prepaid', 'observe', 'manual' FROM businesses WHERE deleted_at IS NULL`);
  await connection.query(`INSERT IGNORE INTO business_ai_accounts (business_id, plan_key, funding_mode, enforcement_mode, cycle_mode) VALUES ('__solvantis_platform__', 'platform', 'account_limit', 'observe', 'calendar_month')`);
  const [verified] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tableNames.map(() => '?').join(',')})`, tableNames);
  if (verified.length !== tableNames.length) throw new Error('AI billing table verification failed.');
  console.log('AI billing schema ready.');
} finally {
  await connection.end();
}