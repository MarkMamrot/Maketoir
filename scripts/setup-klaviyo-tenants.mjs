/**
 * Creates and verifies Klaviyo tables in registered IMS tenant schemas.
 * Dry-run: node scripts/setup-klaviyo-tenants.mjs
 * Apply:   node scripts/setup-klaviyo-tenants.mjs --apply
 * Scope:   append --schema=registered_schema_name
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
const mainDatabase = process.env.MYSQL_DATABASE;
if (!mainDatabase) throw new Error('MYSQL_DATABASE is required to discover registered tenant schemas.');
if (!/^[A-Za-z0-9_]+$/.test(mainDatabase)) throw new Error('MYSQL_DATABASE is invalid.');
if (requestedSchema && !/^[A-Za-z0-9_]+$/.test(requestedSchema)) throw new Error('Requested schema is invalid.');

const tableContracts = {
  ims_klaviyo_profile_mappings: {
    columns: [
      'id', 'business_id', 'contact_id', 'klaviyo_profile_id', 'external_id', 'reconciliation_status',
      'metadata_json', 'last_sync_at', 'safe_error', 'error_at', 'created_at', 'updated_at',
    ],
    indexes: [
      'PRIMARY', 'uq_klaviyo_mapping_contact', 'uq_klaviyo_mapping_profile',
      'uq_klaviyo_mapping_external', 'idx_klaviyo_mapping_status',
    ],
  },
  ims_klaviyo_outbox: {
    columns: [
      'id', 'business_id', 'contact_id', 'operation_key', 'source_type', 'source_id', 'event_type',
      'event_version', 'occurred_at', 'payload_json', 'status', 'attempts', 'available_at', 'locked_at',
      'completed_at', 'safe_error', 'created_at', 'updated_at',
    ],
    indexes: [
      'PRIMARY', 'uq_klaviyo_outbox_operation', 'idx_klaviyo_outbox_work', 'idx_klaviyo_outbox_contact',
    ],
  },
};

function extractDefinition(schema, table) {
  const expression = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  );
  const match = schema.match(expression);
  if (!match) throw new Error(`Canonical definition not found for ${table}.`);
  return match[0]
    .replace(/^\s*CONSTRAINT fk_klaviyo_(?:mapping|outbox)_contact\b[^\n]*,?\r?\n/gm, '')
    .replace(/,\s*(\) ENGINE=)/, '\n$1');
}

async function inspectTable(connection, schema, table) {
  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
  const [indexRows] = await connection.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
  const columns = new Set(columnRows.map(row => row.COLUMN_NAME));
  const indexes = new Set(indexRows.map(row => row.INDEX_NAME));
  const contract = tableContracts[table];
  return {
    exists: columnRows.length > 0,
    missingColumns: contract.columns.filter(column => !columns.has(column)),
    missingIndexes: contract.indexes.filter(index => !indexes.has(index)),
  };
}

const canonicalSchema = await fs.readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
const definitions = Object.fromEntries(
  Object.keys(tableContracts).map(table => [table, extractDefinition(canonicalSchema, table)]),
);
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20_000,
});

try {
  const [businesses] = await connection.query(
    `SELECT business_id, ims_db_name
       FROM \`${mainDatabase}\`.businesses
      WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL
      ORDER BY ims_db_name`,
  );
  const schemas = new Set(businesses.map(row => String(row.ims_db_name)).filter(Boolean));
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  if (requestedSchema && !schemas.has(requestedSchema)) throw new Error('Requested schema is not registered.');
  const selectedSchemas = requestedSchema ? [requestedSchema] : [...schemas].sort();
  if (selectedSchemas.length === 0) throw new Error('No registered IMS tenant schemas found.');

  for (const schema of selectedSchemas) {
    if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error(`Registered IMS schema is invalid: ${schema}`);
    console.log(`Klaviyo tenant-schema plan for ${schema}:`);
    for (const [table, definition] of Object.entries(definitions)) {
      const before = await inspectTable(connection, schema, table);
      console.log(`  ${table}: ${before.exists ? 'exists' : 'will be created'}`);
      if (before.exists && (before.missingColumns.length || before.missingIndexes.length)) {
        console.log(`    missing columns: ${before.missingColumns.join(', ') || 'none'}`);
        console.log(`    missing indexes: ${before.missingIndexes.join(', ') || 'none'}`);
      }
      if (!apply) continue;
      await connection.query(`USE \`${schema}\``);
      await connection.query(definition);
      const after = await inspectTable(connection, schema, table);
      if (!after.exists || after.missingColumns.length || after.missingIndexes.length) {
        throw new Error(`${schema}.${table} failed schema verification.`);
      }
    }
  }

  console.log(apply
    ? `Klaviyo tenant schema applied and verified for ${selectedSchemas.length} schema(s).`
    : 'Dry run only. Re-run with --apply to make these changes.');
} finally {
  await connection.end();
}