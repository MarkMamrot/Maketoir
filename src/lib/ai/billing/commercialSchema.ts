import { getPool } from '@/services/MySQLService';

let schemaPromise: Promise<void> | null = null;

async function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`, [tableName, columnName]);
  if (!rows.length) await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function ensureAiCommercialSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = (async () => {
    const pool = getPool();
    await pool.execute(`CREATE TABLE IF NOT EXISTS ai_provider_models (
      provider VARCHAR(32) NOT NULL DEFAULT 'google',
      model_id VARCHAR(150) NOT NULL,
      is_allowed TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (provider, model_id),
      INDEX idx_ai_provider_models_allowed (provider, is_allowed, model_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS ai_discovered_models (
      provider VARCHAR(32) NOT NULL DEFAULT 'google',
      model_id VARCHAR(150) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      model_version VARCHAR(100) NULL,
      supported_generation_methods JSON NOT NULL,
      input_modalities JSON NOT NULL,
      output_modalities JSON NOT NULL,
      input_token_limit INT UNSIGNED NULL,
      output_token_limit INT UNSIGNED NULL,
      lifecycle_status ENUM('active','preview','deprecated','retired') NOT NULL DEFAULT 'active',
      first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      retired_at DATETIME(3) NULL,
      raw_metadata JSON NULL,
      PRIMARY KEY (provider, model_id),
      INDEX idx_ai_discovered_models_lifecycle (provider, lifecycle_status, model_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS ai_billing_family_mappings (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(32) NOT NULL DEFAULT 'google',
      model_id VARCHAR(150) NOT NULL,
      family_pattern VARCHAR(255) NOT NULL,
      match_type ENUM('contains','regex') NOT NULL DEFAULT 'contains',
      mapping_version INT UNSIGNED NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_ai_billing_family_mapping (provider, model_id, family_pattern, mapping_version),
      INDEX idx_ai_billing_family_active (provider, is_active, model_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS ai_billing_mapping_audit (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      mapping_id BIGINT UNSIGNED NULL,
      action ENUM('create','update','deactivate') NOT NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      actor_user_id INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_ai_billing_mapping_audit (mapping_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS ai_provider_sku_observations (
      provider VARCHAR(32) NOT NULL DEFAULT 'google',
      sku_id VARCHAR(100) NOT NULL,
      sku_name VARCHAR(500) NOT NULL,
      price_name VARCHAR(255) NULL,
      mapped_model_id VARCHAR(150) NULL,
      reconciliation_status ENUM('mapped','unknown_model','unknown_metric','conflicting_rates','incomplete_pricing','unsupported_tier','currency_issue') NOT NULL,
      reason VARCHAR(500) NOT NULL,
      raw_sku JSON NULL,
      raw_price JSON NULL,
      first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (provider, sku_id),
      INDEX idx_ai_provider_sku_reconciliation (provider, reconciliation_status, last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await addColumnIfMissing('ai_plans', 'pricing_mode', `ENUM('rates','markup') NOT NULL DEFAULT 'rates' AFTER is_active`);
    await addColumnIfMissing('ai_plans', 'markup_basis_points', `INT UNSIGNED NOT NULL DEFAULT 0 AFTER pricing_mode`);
    await pool.execute(`INSERT IGNORE INTO ai_provider_models (provider,model_id,is_allowed)
      SELECT provider,model_id,1 FROM ai_provider_rates WHERE effective_to IS NULL GROUP BY provider,model_id`);
    await pool.execute(`INSERT IGNORE INTO ai_discovered_models (provider,model_id,display_name,supported_generation_methods,input_modalities,output_modalities,lifecycle_status)
      SELECT provider,model_id,model_id,JSON_ARRAY('generateContent'),JSON_ARRAY(),JSON_ARRAY(),'active' FROM ai_provider_models`);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}