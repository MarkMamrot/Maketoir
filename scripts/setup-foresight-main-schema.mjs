/**
 * Creates the shared main-database Foresight control-plane tables.
 * Dry-run by default. Pass --apply to execute.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const apply = process.argv.includes('--apply');
const schemaPath = path.join(process.cwd(), 'scripts', 'marketoir-schema.sql');
const schema = await fs.readFile(schemaPath, 'utf8');
const tableNames = [
  'foresight_strategy_versions',
  'foresight_planning_threads',
  'foresight_planning_messages',
  'foresight_planning_tool_calls',
  'foresight_plan_versions',
  'foresight_plan_links',
  'foresight_plan_validations',
  'foresight_plan_review_events',
  'foresight_deliverable_versions',
  'foresight_deliverable_review_events',
  'foresight_campaign_activations',
  'foresight_campaign_activation_outcomes',
  'foresight_campaign_lesson_versions',
  'foresight_campaign_lesson_review_events',
  'foresight_campaign_experiment_versions',
  'foresight_campaign_experiment_review_events',
  'foresight_campaign_experiment_launches',
  'foresight_campaign_experiment_results',
  'foresight_campaign_experiment_result_review_events',
  'foresight_recommendations',
  'foresight_approvals',
  'foresight_recommendation_events',
  'foresight_recommendation_implementations',
  'foresight_recommendation_outcomes',
  'foresight_executions',
  'foresight_digest_runs',
  'foresight_sync_runs',
  'foresight_sync_tabs',
  'foresight_marketing_observations',
  'foresight_marketing_entity_observations',
  'foresight_commerce_observations',
];

const statements = tableNames.map((tableName) => {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName}`;
  const start = schema.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker} in scripts/marketoir-schema.sql`);
  const end = schema.indexOf(';', start);
  if (end < 0) throw new Error(`Unterminated CREATE TABLE for ${tableName}`);
  return schema.slice(start, end + 1);
});
const additiveColumns = [
  { table: 'foresight_approvals', column: 'reason_code', definition: 'VARCHAR(64) NULL AFTER decided_by' },
  { table: 'foresight_recommendation_events', column: 'reason_code', definition: 'VARCHAR(64) NULL AFTER actor_id' },
];

if (!apply) {
  console.log(`Dry run: would create or verify ${statements.length} Foresight tables and ${additiveColumns.length} additive columns in ${process.env.MYSQL_DATABASE || '(unset database)'}.`);
  console.log('Re-run with --apply to execute.');
  process.exit(0);
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: false,
});

try {
  for (const statement of statements) {
    await connection.execute(statement);
  }
  for (const migration of additiveColumns) {
    const [rows] = await connection.execute(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [migration.table, migration.column],
    );
    if (rows.length === 0) {
      await connection.execute(
        `ALTER TABLE \`${migration.table}\` ADD COLUMN \`${migration.column}\` ${migration.definition}`,
      );
    }
  }
  console.log(`Created or verified ${statements.length} Foresight tables and ${additiveColumns.length} additive columns.`);
} finally {
  await connection.end();
}
