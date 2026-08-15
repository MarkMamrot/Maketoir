import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  return match ? [match[1], match[2]] : [arg.replace(/^--/, ''), true];
}));

const apply = args.apply === true;
const sourceBusinessId = String(args['source-business-id'] ?? '').trim();
const targetBusinessId = String(args['target-business-id'] ?? '').trim();
const targetName = String(args['target-name'] ?? 'Monsterthreads DEV SANDBOX').trim();
const targetSchema = safeIdentifier(String(args['target-schema'] ?? '').trim(), 'target schema');
const confirmedSourceName = String(args['confirm-source-name'] ?? '').trim();
const backupConfirmedAt = String(args['backup-confirmed-at'] ?? '').trim();
const excludedSourceTablePatterns = [/^_archived_/];
const reportPath = path.resolve(
  process.cwd(),
  String(args['report'] ?? `tmp/sandbox-clone-${targetBusinessId || 'manifest'}-${Date.now()}.json`),
);

function fail(message) {
  throw new Error(message);
}

function safeIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(value)) fail(`Invalid ${label}: ${value || '(empty)'}`);
  return value;
}

function quoteIdentifier(value) {
  return `\`${safeIdentifier(value, 'SQL identifier')}\``;
}

function requireArguments() {
  if (!sourceBusinessId) fail('Missing --source-business-id');
  if (!targetBusinessId) fail('Missing --target-business-id');
  if (sourceBusinessId === targetBusinessId) fail('Source and target business IDs must differ');
  if (!targetName) fail('Missing --target-name');
  if (!confirmedSourceName) fail('Missing --confirm-source-name');
  if (!backupConfirmedAt || Number.isNaN(Date.parse(backupConfirmedAt))) {
    fail('--backup-confirmed-at must be an ISO date/time for a verified restore point');
  }
}

function serverConfig(database) {
  return {
    host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    multipleStatements: false,
  };
}

async function schemaExists(connection, schema) {
  const [rows] = await connection.execute(
    'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1',
    [schema],
  );
  return rows.length > 0;
}

async function tableMetadata(connection, schema) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, IS_NULLABLE, COLUMN_DEFAULT,
            EXTRA, DATA_TYPE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [schema],
  );
  const tables = new Map();
  for (const row of rows) {
    const table = String(row.TABLE_NAME);
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table).push({
      name: String(row.COLUMN_NAME),
      nullable: String(row.IS_NULLABLE) === 'YES',
      defaultValue: row.COLUMN_DEFAULT,
      extra: String(row.EXTRA ?? ''),
      dataType: String(row.DATA_TYPE),
      columnType: String(row.COLUMN_TYPE),
    });
  }
  return tables;
}

async function rowCounts(connection, schema, tableNames) {
  const counts = {};
  for (const table of tableNames) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

async function installBusinessIdTriggers(connection) {
  const derive = (column) =>
    `SET NEW.business_id = IF(NEW.business_id IS NULL OR NEW.business_id = '',` +
    ` COALESCE((SELECT p.business_id FROM ims_product_variants v` +
    ` JOIN ims_products p ON p.product_id = v.product_id` +
    ` WHERE v.variant_id = NEW.${column} LIMIT 1), ''), NEW.business_id)`;
  for (const trigger of [
    { name: 'trg_ims_stock_bizid', table: 'ims_stock', column: 'variant_id' },
    { name: 'trg_ims_sales_cache_bizid', table: 'ims_sales_cache', column: 'variant_id' },
  ]) {
    await connection.query(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)}`);
    await connection.query(
      `CREATE TRIGGER ${quoteIdentifier(trigger.name)} BEFORE INSERT ON ${quoteIdentifier(trigger.table)} ` +
      `FOR EACH ROW ${derive(trigger.column)}`,
    );
  }
}

function compareSchemas(sourceTables, targetTables) {
  const errors = [];
  const sourceNames = [...sourceTables.keys()].sort();
  const targetNames = [...targetTables.keys()].sort();
  for (const table of new Set([...sourceNames, ...targetNames])) {
    const source = sourceTables.get(table);
    const target = targetTables.get(table);
    if (!source) {
      errors.push(`Target-only table: ${table}`);
      continue;
    }
    if (!target) {
      errors.push(`Source-only table: ${table}`);
      continue;
    }
    const sourceColumns = source.map((column) => `${column.name}:${column.columnType}`);
    const targetColumns = target.map((column) => `${column.name}:${column.columnType}`);
    if (JSON.stringify(sourceColumns) !== JSON.stringify(targetColumns)) {
      errors.push(`Column drift: ${table}`);
    }
  }
  return errors;
}

async function createTargetSchema(server, sourceSchema, tableNames) {
  await server.query(
    `CREATE DATABASE ${quoteIdentifier(targetSchema)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  const target = await mysql.createConnection(serverConfig(targetSchema));
  try {
    await target.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tableNames) {
      const [rows] = await server.query(
        `SHOW CREATE TABLE ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(table)}`,
      );
      const statement = rows[0]?.['Create Table'];
      if (!statement) fail(`Unable to read source DDL for ${table}`);
      await target.query(statement);
    }
    await target.query('SET FOREIGN_KEY_CHECKS = 1');
    await installBusinessIdTriggers(target);
  } finally {
    await target.end();
  }
}

async function createQuarantinedBusiness(main, source) {
  await main.execute(
    `INSERT INTO businesses
       (business_id, name, ims_db_name, has_foresight, has_ims, has_pos,
        is_sandbox, automation_paused, deleted_at)
     VALUES (?, ?, ?, ?, 1, ?, 1, 1, NOW())`,
    [targetBusinessId, targetName, targetSchema, Number(source.has_foresight ?? 0), Number(source.has_pos ?? 1)],
  );
  await main.execute('INSERT INTO connections (business_id) VALUES (?)', [targetBusinessId]);
}

async function copyImsSnapshot(connection, sourceSchema, sourceTables) {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  try {
    for (const [table, columns] of sourceTables) {
      const names = columns.map((column) => quoteIdentifier(column.name)).join(', ');
      const expressions = columns.map((column) => {
        if (column.name !== 'business_id') return quoteIdentifier(column.name);
        return `CASE WHEN ${quoteIdentifier(column.name)} IS NULL OR ${quoteIdentifier(column.name)} = '' ` +
          `THEN ${quoteIdentifier(column.name)} ELSE ? END`;
      });
      const params = columns.some((column) => column.name === 'business_id') ? [targetBusinessId] : [];
      if (table === 'ims_sales_history') continue;
      const sourceFilter = table === 'ims_contacts'
        ? ` WHERE type <> 'retail_customer' OR shopify_customer_id IS NULL OR shopify_customer_id = ''` +
          ` OR id IN (SELECT contact_id FROM ${quoteIdentifier(targetSchema)}.sandbox_retained_contact_ids)`
        : '';
      await connection.execute(
        `INSERT INTO ${quoteIdentifier(targetSchema)}.${quoteIdentifier(table)} (${names}) ` +
        `SELECT ${expressions.join(', ')} FROM ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(table)}${sourceFilter}`,
        params,
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function contactRetentionPlan(connection, sourceSchema, sourceTables) {
  const referenceColumns = [];
  for (const [table, columns] of sourceTables) {
    if (table === 'ims_contacts') continue;
    for (const column of columns) {
      if (['customer_id', 'supplier_id', 'contact_id'].includes(column.name)) {
        referenceColumns.push({ table, column: column.name });
      }
    }
  }
  const unions = referenceColumns.map(({ table, column }) =>
    `SELECT ${quoteIdentifier(column)} AS contact_id FROM ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(table)} ` +
    `WHERE ${quoteIdentifier(column)} IS NOT NULL`,
  );
  const referenceSql = unions.length ? unions.join(' UNION ') : 'SELECT NULL AS contact_id WHERE FALSE';
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS retained
       FROM ${quoteIdentifier(sourceSchema)}.ims_contacts c
      WHERE c.type <> 'retail_customer'
         OR c.shopify_customer_id IS NULL OR c.shopify_customer_id = ''
         OR c.id IN (SELECT contact_id FROM (${referenceSql}) referenced_contacts)`,
  );
  return { referenceColumns, retainedCount: Number(rows[0]?.retained ?? 0), referenceSql };
}

async function createRetainedContactIds(connection, sourceSchema, plan) {
  await connection.query(
    `CREATE TEMPORARY TABLE ${quoteIdentifier(targetSchema)}.sandbox_retained_contact_ids (` +
    `contact_id INT PRIMARY KEY) ENGINE=MEMORY`,
  );
  await connection.query(
    `INSERT IGNORE INTO ${quoteIdentifier(targetSchema)}.sandbox_retained_contact_ids (contact_id) ` +
    `SELECT contact_id FROM (${plan.referenceSql}) referenced_contacts WHERE contact_id IS NOT NULL`,
  );
}

function integrationIdentityColumns(columns) {
  return columns.filter((column) =>
    column.name !== 'shopify_payout_id' && (
      /^(shopify|xero)_.+_id$/.test(column.name) ||
      /^(target_)?xero_.+_id$/.test(column.name) ||
      /^(shopify|xero)_(id|status|state|error)$/.test(column.name) ||
      /^(zeller_site_id|zeller_terminal_id|zeller_api_key)$/.test(column.name)
    ),
  );
}

function authenticationColumns(columns) {
  return columns.filter((column) =>
    /^(password_hash|manager_pin_hash|pos_pin_hash)$/.test(column.name),
  );
}

async function clearColumns(connection, table, columns) {
  if (!columns.length) return;
  const assignments = columns.map((column) => {
    const emptyValue = column.nullable ? 'NULL' : "''";
    return `${quoteIdentifier(column.name)} = ${emptyValue}`;
  });
  await connection.query(
    `UPDATE ${quoteIdentifier(table)} SET ${assignments.join(', ')}`,
  );
}

async function upsertSetting(connection, key, value) {
  await connection.execute(
    `INSERT INTO ims_settings (business_id, \`key\`, value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [targetBusinessId, key, value],
  );
}

async function sanitizeTargetIms(targetTables) {
  const target = await mysql.createConnection(serverConfig(targetSchema));
  try {
    await target.beginTransaction();
    const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    for (const [table, columns] of targetTables) {
      await clearColumns(target, table, integrationIdentityColumns(columns));
      const authColumns = authenticationColumns(columns);
      if (authColumns.length) {
        const assignments = authColumns.map((column) =>
          `${quoteIdentifier(column.name)} = ${column.nullable ? 'NULL' : '?'}`,
        );
        const params = authColumns.filter((column) => !column.nullable).map(() => unusablePasswordHash);
        await target.execute(
          `UPDATE ${quoteIdentifier(table)} SET ${assignments.join(', ')}`,
          params,
        );
      }
      const historical = columns.find((column) => column.name === 'is_historical');
      if (historical) await target.query(`UPDATE ${quoteIdentifier(table)} SET is_historical = 1`);
    }

    for (const table of [
      'ims_shopify_inventory_queue',
      'ims_shopify_sync_log',
      'ims_shopify_payout_lines',
      'ims_shopify_payouts',
    ]) {
      if (targetTables.has(table)) await target.query(`DELETE FROM ${quoteIdentifier(table)}`);
    }

    if (targetTables.has('ims_settings')) {
      const deleteKeys = [
        'shopify_webhook_secret', 'shopify_inventory_location_id',
        'online_sales_customer_id', 'shopify_fallback_variant_id',
        'shopify_inventory_sync_last_run_at', 'last_products_sync',
        'last_orders_sync', 'last_stocktake_sync', 'gmail_history_id',
      ];
      await target.query(
        `DELETE FROM ims_settings WHERE business_id = ? AND \`key\` IN (${deleteKeys.map(() => '?').join(', ')})`,
        [targetBusinessId, ...deleteKeys],
      );
      await upsertSetting(target, 'shopify_order_sync_enabled', '0');
      await upsertSetting(target, 'shopify_inventory_sync_enabled', '0');
      await upsertSetting(target, 'shopify_xero_auto_sync_enabled', '0');
      await upsertSetting(target, 'shopify_order_sync_from', '2099-01-01');
    }

    if (targetTables.has('ims_cs_settings')) {
      await target.query(
        `UPDATE ims_cs_settings
            SET enabled = 0, automation_mode = 'draft', gmail_history_id = NULL,
                last_run_at = NULL, next_run_at = NULL, last_error = NULL,
                lock_owner = NULL, lock_claimed_at = NULL, helper_emails_json = '[]'
          WHERE business_id = ?`,
        [targetBusinessId],
      );
    }

    await target.commit();
  } catch (error) {
    await target.rollback();
    throw error;
  } finally {
    await target.end();
  }
}

async function seedDenyFirstMainState(main) {
  const [mainTableRows] = await main.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  const mainTables = new Set(mainTableRows.map((row) => String(row.TABLE_NAME)));

  if (mainTables.has('xero_document_policies')) {
    await main.execute(
      `INSERT INTO xero_document_policies
         (business_id, po_approved_action, po_completed_action, po_payment_sync_enabled,
          so_approved_action, so_completed_action, so_payment_sync_enabled,
          manual_customer_cn_action, supplier_cn_action, shortfall_credit_draft_first,
          pos_batch_sync_enabled, pos_batch_payment_sync_enabled,
          online_batch_action, online_batch_payment_sync_enabled, shopify_payout_auto_post_enabled)
       VALUES (?, 'none', 'none', 0, 'none', 'none', 0, 'none', 'none', 1, 0, 0, 'none', 0, 0)`,
      [targetBusinessId],
    );
  }
  if (mainTables.has('xero_reconciliation_settings')) {
    await main.execute(
      `INSERT INTO xero_reconciliation_settings
         (business_id, enabled, recipients_json, digest_frequency)
       VALUES (?, 0, JSON_ARRAY(), 'off')`,
      [targetBusinessId],
    );
  }
  if (mainTables.has('xero_cogs_settings')) {
    await main.execute(
      `INSERT INTO xero_cogs_settings (business_id, enabled, frequency, timezone)
       VALUES (?, 0, 'monthly', 'Australia/Sydney')`,
      [targetBusinessId],
    );
  }
}

async function verifyTarget(main, sourceSchema, expectedCounts, targetTables) {
  const target = await mysql.createConnection(serverConfig(targetSchema));
  const checks = [];
  try {
    const targetCounts = await rowCounts(target, targetSchema, [...targetTables.keys()]);
    const intentionallyEmptiedTables = new Set([
      'ims_shopify_inventory_queue',
      'ims_shopify_sync_log',
      'ims_shopify_payout_lines',
      'ims_shopify_payouts',
    ]);
    for (const [table, transformedCount] of Object.entries(expectedCounts)) {
      const expected = intentionallyEmptiedTables.has(table) ? 0 : transformedCount;
      checks.push({
        check: `row_count:${table}`,
        passed: targetCounts[table] === expected,
        expected,
        actual: targetCounts[table],
      });
    }

    for (const [table, columns] of targetTables) {
      if (!columns.some((column) => column.name === 'business_id')) continue;
      const [rows] = await target.execute(
        `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE business_id = ?`,
        [sourceBusinessId],
      );
      checks.push({ check: `source_stamp_absent:${table}`, passed: Number(rows[0]?.count ?? 0) === 0 });
    }

    const identityLeaks = [];
    for (const [table, columns] of targetTables) {
      for (const column of integrationIdentityColumns(columns)) {
        const [rows] = await target.query(
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} ` +
          `WHERE ${quoteIdentifier(column.name)} IS NOT NULL AND ${quoteIdentifier(column.name)} <> ''`,
        );
        if (Number(rows[0]?.count ?? 0) > 0) identityLeaks.push(`${table}.${column.name}`);
      }
    }
    checks.push({ check: 'external_identity_columns_empty', passed: identityLeaks.length === 0, failures: identityLeaks });

    const [settings] = await target.execute(
      `SELECT \`key\`, value FROM ims_settings WHERE business_id = ? AND \`key\` IN
       ('shopify_order_sync_enabled','shopify_inventory_sync_enabled','shopify_xero_auto_sync_enabled')`,
      [targetBusinessId],
    );
    const values = new Map(settings.map((row) => [String(row.key), String(row.value)]));
    checks.push({
      check: 'shopify_automation_disabled',
      passed: ['shopify_order_sync_enabled', 'shopify_inventory_sync_enabled', 'shopify_xero_auto_sync_enabled']
        .every((key) => values.get(key) === '0'),
    });

    const [connectionRows] = await main.execute('SELECT * FROM connections WHERE business_id = ?', [targetBusinessId]);
    const connection = connectionRows[0] ?? {};
    const populatedConnectionFields = Object.entries(connection)
      .filter(([key, value]) => !['business_id', 'updated_at'].includes(key) && value !== null && value !== '')
      .map(([key]) => key);
    checks.push({
      check: 'connections_empty',
      passed: populatedConnectionFields.length === 0,
      failures: populatedConnectionFields,
    });

    const failed = checks.filter((check) => !check.passed);
    return { sourceSchema, targetCounts, checks, passed: failed.length === 0, failed };
  } finally {
    await target.end();
  }
}

async function writeReport(report) {
  const unsigned = JSON.stringify(report, null, 2);
  const digest = crypto.createHash('sha256').update(unsigned).digest('hex');
  const signed = JSON.stringify({ ...report, reportSha256: digest }, null, 2);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${signed}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Report: ${reportPath}`);
  console.log(`SHA-256: ${digest}`);
}

async function main() {
  requireArguments();
  const mainDb = safeIdentifier(String(process.env.MYSQL_DATABASE ?? ''), 'MYSQL_DATABASE');
  const main = await mysql.createConnection(serverConfig(mainDb));
  const server = await mysql.createConnection(serverConfig());
  let targetCreated = false;
  let businessCreated = false;
  try {
    const [controlColumns] = await main.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses'
          AND COLUMN_NAME IN ('is_sandbox', 'automation_paused')`,
    );
    if (controlColumns.length !== 2) {
      fail('Run scripts/add-business-sandbox-controls.mjs before cloning');
    }

    const [sourceRows] = await main.execute(
      `SELECT business_id, name, ims_db_name, has_foresight, has_pos
         FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sourceBusinessId],
    );
    const source = sourceRows[0];
    if (!source) fail(`Active source business not found: ${sourceBusinessId}`);
    if (String(source.name) !== confirmedSourceName) {
      fail(`Source name confirmation mismatch; expected exactly: ${source.name}`);
    }
    const sourceSchema = safeIdentifier(String(source.ims_db_name ?? ''), 'source IMS schema');
    if (sourceSchema === targetSchema) fail('Source and target IMS schemas must differ');

    const [targetRows] = await main.execute(
      'SELECT business_id FROM businesses WHERE business_id = ? LIMIT 1',
      [targetBusinessId],
    );
    if (targetRows.length) fail(`Target business already exists: ${targetBusinessId}`);
    if (await schemaExists(server, targetSchema)) fail(`Target schema already exists: ${targetSchema}`);
    if (!(await schemaExists(server, sourceSchema))) fail(`Source schema not found: ${sourceSchema}`);

    const allSourceTables = await tableMetadata(server, sourceSchema);
    const excludedSourceTables = [...allSourceTables.keys()]
      .filter((table) => excludedSourceTablePatterns.some((pattern) => pattern.test(table)));
    const sourceTables = new Map(
      [...allSourceTables].filter(([table]) => !excludedSourceTables.includes(table)),
    );
    const sourceCounts = await rowCounts(server, sourceSchema, [...sourceTables.keys()]);
    const contactPlan = await contactRetentionPlan(server, sourceSchema, sourceTables);
    const expectedCounts = {
      ...sourceCounts,
      ims_contacts: contactPlan.retainedCount,
      ims_sales_history: 0,
    };
    const manifest = {
      generatedAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      backupConfirmedAt: new Date(backupConfirmedAt).toISOString(),
      source: { businessId: sourceBusinessId, name: source.name, schema: sourceSchema },
      target: { businessId: targetBusinessId, name: targetName, schema: targetSchema },
      safeguards: {
        sandbox: true,
        automationPaused: true,
        quarantinedDuringClone: true,
        credentialsCopied: false,
        mainBusinessDataCopied: false,
        fullImsSnapshotCopied: true,
      },
      sourceTableCount: sourceTables.size,
      sourceRowCounts: sourceCounts,
      expectedTargetRowCounts: expectedCounts,
      excludedSourceTables,
      filteredData: {
        ims_sales_history: 'Excluded: historical Cin7 sales import',
        ims_contacts: {
          rule: 'Keep non-retail contacts and retail contacts referenced by retained operational tables',
          sourceCount: sourceCounts.ims_contacts,
          retainedCount: contactPlan.retainedCount,
          excludedCount: sourceCounts.ims_contacts - contactPlan.retainedCount,
          referenceColumns: contactPlan.referenceColumns,
        },
      },
      transformations: [
        'Rewrite non-empty IMS business_id values to the target business ID',
        'Clear Shopify, Xero, and Zeller external identity columns',
        'Mark cloned records historical where is_historical exists',
        'Disable Shopify, Xero, COGS, reconciliation, email, and shared scheduled automation',
        'Replace POS passwords and clear contact password/PIN hashes',
      ],
      excludedMainData: 'All source business-scoped main DB rows; target starts with an empty connections row and deny-first Xero settings',
    };

    if (!apply) {
      await writeReport({ ...manifest, result: 'dry_run_complete' });
      console.log('DRY RUN COMPLETE. Re-run with --apply only after reviewing the manifest.');
      return;
    }

    await createQuarantinedBusiness(main, source);
    businessCreated = true;
    await createTargetSchema(server, sourceSchema, [...sourceTables.keys()]);
    targetCreated = true;

    const targetTables = await tableMetadata(server, targetSchema);
    const schemaErrors = compareSchemas(sourceTables, targetTables);
    if (schemaErrors.length) fail(`Source/target schema mismatch:\n${schemaErrors.join('\n')}`);

    await createRetainedContactIds(server, sourceSchema, contactPlan);
    await copyImsSnapshot(server, sourceSchema, sourceTables);
    await sanitizeTargetIms(targetTables);
    await seedDenyFirstMainState(main);
    const verification = await verifyTarget(main, sourceSchema, expectedCounts, targetTables);
    if (!verification.passed) fail(`Sandbox verification failed: ${JSON.stringify(verification.failed)}`);

    await main.execute(
      `UPDATE businesses
          SET deleted_at = NULL, has_ims = 1, is_sandbox = 1, automation_paused = 1
        WHERE business_id = ?`,
      [targetBusinessId],
    );
    await writeReport({ ...manifest, result: 'applied_and_verified', verification });
    console.log('SANDBOX CLONE COMPLETE. Scheduled automation remains paused.');
  } catch (error) {
    if (businessCreated) {
      await main.execute(
        `UPDATE businesses SET deleted_at = COALESCE(deleted_at, NOW()), automation_paused = 1
          WHERE business_id = ?`,
        [targetBusinessId],
      ).catch(() => undefined);
    }
    console.error(`Sandbox clone failed: ${error instanceof Error ? error.message : String(error)}`);
    if (targetCreated || businessCreated) {
      console.error('The target remains quarantined. Inspect it before running any cleanup.');
    }
    process.exitCode = 1;
  } finally {
    await main.end();
    await server.end();
  }
}

await main();
