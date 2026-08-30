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
    await addColumnIfMissing('ai_plans', 'pricing_mode', `ENUM('rates','markup') NOT NULL DEFAULT 'rates' AFTER is_active`);
    await addColumnIfMissing('ai_plans', 'markup_basis_points', `INT UNSIGNED NOT NULL DEFAULT 0 AFTER pricing_mode`);
    await pool.execute(`INSERT IGNORE INTO ai_provider_models (provider,model_id,is_allowed)
      SELECT provider,model_id,1 FROM ai_provider_rates WHERE effective_to IS NULL GROUP BY provider,model_id`);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}