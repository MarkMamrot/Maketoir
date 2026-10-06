import { createHash } from 'node:crypto';

const identifierPattern = /^[A-Za-z0-9_]+$/;
const allowedOperationKinds = new Set([
  'drop_foreign_key',
  'alter_table_collations',
  'add_foreign_key',
]);

function quoteIdentifier(identifier) {
  if (!identifierPattern.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

function hashStatements(statements) {
  return createHash('sha256').update(JSON.stringify(statements)).digest('hex');
}

function hashStatement(statement) {
  return createHash('sha256').update(statement).digest('hex');
}

export function expectedApplyConfirmation(schema, planHash) {
  if (!identifierPattern.test(schema)) throw new Error(`Unsafe SQL identifier: ${schema}`);
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw new Error('Plan hash must be SHA-256.');
  return `APPLY-COLLATION-${schema}-${planHash.slice(0, 12)}`;
}

export function validateApplyRequest({
  schema,
  plan,
  expectedMetadataHash,
  expectedPlanHash,
  confirmation,
  backupReference,
  maintenanceConfirmed,
}) {
  if (!identifierPattern.test(schema) || plan.schema !== schema) throw new Error('Apply schema does not match the plan.');
  if (!maintenanceConfirmed) throw new Error('Apply requires explicit maintenance suspension confirmation.');
  if (typeof backupReference !== 'string' || backupReference.trim().length < 6) {
    throw new Error('Apply requires a non-secret verified backup reference.');
  }
  if (plan.sourceMetadataHash !== expectedMetadataHash) throw new Error('Reviewed metadata hash does not match.');
  if (plan.planHash !== expectedPlanHash) throw new Error('Reviewed plan hash does not match.');
  if (hashStatements(plan.statements) !== plan.planHash) throw new Error('Plan statements do not match the plan hash.');
  if (!Array.isArray(plan.operations) || plan.operations.length !== plan.statements.length) {
    throw new Error('Plan operation metadata is incomplete.');
  }
  for (const [index, operation] of plan.operations.entries()) {
    if (!allowedOperationKinds.has(operation.kind)) throw new Error(`Unsupported plan operation: ${operation.kind}`);
    if (operation.statement !== plan.statements[index]) throw new Error(`Plan operation ${index} does not match its statement.`);
    if (/\bCONVERT\s+TO\s+CHARACTER\s+SET\b/i.test(operation.statement)) {
      throw new Error('Broad character-set conversion is forbidden.');
    }
  }
  const expectedConfirmation = expectedApplyConfirmation(schema, plan.planHash);
  if (confirmation !== expectedConfirmation) throw new Error(`Apply confirmation must equal ${expectedConfirmation}.`);
}

async function foreignKeyDefinition(connection, schema, foreignKey) {
  const [rows] = await connection.query(
    `SELECT
       kcu.COLUMN_NAME,
       kcu.REFERENCED_TABLE_NAME,
       kcu.REFERENCED_COLUMN_NAME,
       kcu.ORDINAL_POSITION,
       rc.UPDATE_RULE,
       rc.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
    WHERE kcu.CONSTRAINT_SCHEMA = ?
      AND kcu.TABLE_NAME = ?
      AND kcu.CONSTRAINT_NAME = ?
    ORDER BY kcu.ORDINAL_POSITION`,
    [schema, foreignKey.table, foreignKey.name],
  );
  if (rows.length === 0) return null;
  return {
    table: foreignKey.table,
    name: foreignKey.name,
    referencedTable: String(rows[0].REFERENCED_TABLE_NAME),
    updateRule: String(rows[0].UPDATE_RULE),
    deleteRule: String(rows[0].DELETE_RULE),
    columns: rows.map(row => String(row.COLUMN_NAME)),
    referencedColumns: rows.map(row => String(row.REFERENCED_COLUMN_NAME)),
  };
}

function sameForeignKey(left, right) {
  return left?.table === right.table
    && left?.name === right.name
    && left?.referencedTable === right.referencedTable
    && left?.updateRule === right.updateRule
    && left?.deleteRule === right.deleteRule
    && JSON.stringify(left?.columns) === JSON.stringify(right.columns)
    && JSON.stringify(left?.referencedColumns) === JSON.stringify(right.referencedColumns);
}

export async function operationSatisfied(connection, schema, operation, contract) {
  if (operation.kind === 'drop_foreign_key') {
    return (await foreignKeyDefinition(connection, schema, operation.foreignKey)) === null;
  }
  if (operation.kind === 'add_foreign_key') {
    return sameForeignKey(
      await foreignKeyDefinition(connection, schema, operation.foreignKey),
      operation.foreignKey,
    );
  }
  if (operation.kind === 'alter_table_collations') {
    const [tableRows] = await connection.query(
      `SELECT TABLE_COLLATION
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [schema, operation.table],
    );
    if (tableRows.length !== 1) throw new Error(`Migration table is missing: ${operation.table}.`);
    if (operation.updateTableDefault && tableRows[0].TABLE_COLLATION !== contract.textCollation) return false;
    if (operation.identityColumns.length === 0) return true;
    const [columnRows] = await connection.query(
      `SELECT COLUMN_NAME, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
      [schema, operation.table, operation.identityColumns],
    );
    const collations = new Map(columnRows.map(row => [String(row.COLUMN_NAME), row.COLLATION_NAME]));
    return operation.identityColumns.every(column => collations.get(column) === contract.identityCollation);
  }
  throw new Error(`Unsupported plan operation: ${operation.kind}`);
}

async function ensureJournalTables(connection, schema) {
  const prefix = quoteIdentifier(schema);
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${prefix}.\`_solvantis_collation_migration_runs\` (
       plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
       source_metadata_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       contract_version INT NOT NULL,
       backup_reference VARCHAR(255) NOT NULL,
       plan_json LONGTEXT NOT NULL,
       status ENUM('running','failed','applied') NOT NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
       completed_at DATETIME(3) NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${prefix}.\`_solvantis_collation_migration_steps\` (
       plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       step_index INT NOT NULL,
       operation_kind VARCHAR(40) NOT NULL,
       table_name VARCHAR(64) NOT NULL,
       statement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       status ENUM('pending','running','reconciled','applied','failed') NOT NULL DEFAULT 'pending',
       safe_error VARCHAR(500) NULL,
       started_at DATETIME(3) NULL,
       completed_at DATETIME(3) NULL,
       PRIMARY KEY (plan_hash, step_index)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

export async function loadJournaledCollationPlan(connection, schema, planHash) {
  if (!identifierPattern.test(schema)) throw new Error(`Unsafe SQL identifier: ${schema}`);
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw new Error('Plan hash must be SHA-256.');
  const [tableRows] = await connection.query(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = '_solvantis_collation_migration_runs'
      LIMIT 1`,
    [schema],
  );
  if (tableRows.length === 0) throw new Error('No collation migration journal exists for this schema.');
  const [runRows] = await connection.execute(
    `SELECT plan_json
       FROM ${quoteIdentifier(schema)}.\`_solvantis_collation_migration_runs\`
      WHERE plan_hash = ?`,
    [planHash],
  );
  if (runRows.length !== 1) throw new Error('Requested collation migration plan is not journaled.');
  const plan = JSON.parse(String(runRows[0].plan_json));
  if (plan.planHash !== planHash) throw new Error('Journaled collation plan hash is inconsistent.');
  return plan;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : 'Unknown migration failure';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

export async function applyCollationMigrationPlan({
  connection,
  schema,
  plan,
  contract,
  backupReference,
  lockWaitSeconds = 10,
}) {
  if (!Number.isInteger(lockWaitSeconds) || lockWaitSeconds < 1 || lockWaitSeconds > 60) {
    throw new Error('Lock wait must be an integer from 1 to 60 seconds.');
  }
  await ensureJournalTables(connection, schema);
  const prefix = quoteIdentifier(schema);
  const planJson = JSON.stringify(plan);
  await connection.execute(
    `INSERT IGNORE INTO ${prefix}.\`_solvantis_collation_migration_runs\`
       (plan_hash, source_metadata_hash, contract_version, backup_reference, plan_json, status)
     VALUES (?, ?, ?, ?, ?, 'running')`,
    [plan.planHash, plan.sourceMetadataHash, plan.contractVersion, backupReference, planJson],
  );
  const [runRows] = await connection.execute(
    `SELECT source_metadata_hash, contract_version, backup_reference, plan_json, status
       FROM ${prefix}.\`_solvantis_collation_migration_runs\`
      WHERE plan_hash = ?`,
    [plan.planHash],
  );
  const existingRun = runRows[0];
  if (!existingRun
    || existingRun.source_metadata_hash !== plan.sourceMetadataHash
    || Number(existingRun.contract_version) !== plan.contractVersion
    || existingRun.backup_reference !== backupReference
    || existingRun.plan_json !== planJson) {
    throw new Error('Existing migration journal does not match the reviewed plan.');
  }
  if (existingRun.status === 'applied') return { applied: 0, reconciled: 0, skipped: plan.operations.length };

  await connection.query(`SET SESSION lock_wait_timeout = ${Number(lockWaitSeconds)}`);
  await connection.query(`SET SESSION innodb_lock_wait_timeout = ${Number(lockWaitSeconds)}`);
  let applied = 0;
  let reconciled = 0;
  let skipped = 0;
  for (const [index, operation] of plan.operations.entries()) {
    const statementHash = hashStatement(operation.statement);
    await connection.execute(
      `INSERT IGNORE INTO ${prefix}.\`_solvantis_collation_migration_steps\`
         (plan_hash, step_index, operation_kind, table_name, statement_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [plan.planHash, index, operation.kind, operation.table, statementHash],
    );
    const [stepRows] = await connection.execute(
      `SELECT operation_kind, table_name, statement_hash, status
         FROM ${prefix}.\`_solvantis_collation_migration_steps\`
        WHERE plan_hash = ? AND step_index = ?`,
      [plan.planHash, index],
    );
    const step = stepRows[0];
    if (!step
      || step.operation_kind !== operation.kind
      || step.table_name !== operation.table
      || step.statement_hash !== statementHash) {
      throw new Error(`Migration journal step ${index} does not match the reviewed plan.`);
    }
    if (step.status === 'applied' || step.status === 'reconciled') {
      skipped += 1;
      continue;
    }
    if (await operationSatisfied(connection, schema, operation, contract)) {
      await connection.execute(
        `UPDATE ${prefix}.\`_solvantis_collation_migration_steps\`
            SET status = 'reconciled', safe_error = NULL, completed_at = CURRENT_TIMESTAMP(3)
          WHERE plan_hash = ? AND step_index = ?`,
        [plan.planHash, index],
      );
      reconciled += 1;
      continue;
    }
    await connection.execute(
      `UPDATE ${prefix}.\`_solvantis_collation_migration_steps\`
          SET status = 'running', safe_error = NULL, started_at = CURRENT_TIMESTAMP(3), completed_at = NULL
        WHERE plan_hash = ? AND step_index = ?`,
      [plan.planHash, index],
    );
    try {
      await connection.query(operation.statement);
      if (!(await operationSatisfied(connection, schema, operation, contract))) {
        throw new Error(`Migration step ${index} did not reach its expected state.`);
      }
      await connection.execute(
        `UPDATE ${prefix}.\`_solvantis_collation_migration_steps\`
            SET status = 'applied', safe_error = NULL, completed_at = CURRENT_TIMESTAMP(3)
          WHERE plan_hash = ? AND step_index = ?`,
        [plan.planHash, index],
      );
      applied += 1;
    } catch (error) {
      await connection.execute(
        `UPDATE ${prefix}.\`_solvantis_collation_migration_steps\`
            SET status = 'failed', safe_error = ?, completed_at = CURRENT_TIMESTAMP(3)
          WHERE plan_hash = ? AND step_index = ?`,
        [safeError(error), plan.planHash, index],
      );
      await connection.execute(
        `UPDATE ${prefix}.\`_solvantis_collation_migration_runs\`
            SET status = 'failed'
          WHERE plan_hash = ?`,
        [plan.planHash],
      );
      throw error;
    }
  }
  await connection.execute(
    `UPDATE ${prefix}.\`_solvantis_collation_migration_runs\`
        SET status = 'applied', completed_at = CURRENT_TIMESTAMP(3)
      WHERE plan_hash = ?`,
    [plan.planHash],
  );
  return { applied, reconciled, skipped };
}