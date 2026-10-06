import { createHash } from 'node:crypto';

const identifierPattern = /^[A-Za-z0-9_]+$/;

function quoteIdentifier(identifier) {
  if (!identifierPattern.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBinaryColumnDefinition({ createStatement, column, columnType, contract }) {
  const line = createStatement.split(/\r?\n/).find(candidate =>
    new RegExp(`^\\s*${quoteIdentifier(column)}\\s+`, 'i').test(candidate),
  );
  if (!line) throw new Error(`SHOW CREATE TABLE is missing column ${column}.`);
  const definition = line.trim().replace(/,$/, '');
  const prefix = new RegExp(`^${escapeRegExp(quoteIdentifier(column))}\\s+${escapeRegExp(columnType)}`, 'i');
  if (!prefix.test(definition)) {
    throw new Error(`SHOW CREATE TABLE type mismatch for ${column}: expected ${columnType}.`);
  }
  const suffix = definition
    .replace(prefix, '')
    .replace(/\s+CHARACTER SET\s+[A-Za-z0-9_]+/gi, '')
    .replace(/\s+COLLATE\s+[A-Za-z0-9_]+/gi, '');
  return `${quoteIdentifier(column)} ${columnType} CHARACTER SET ${contract.characterSet} COLLATE ${contract.identityCollation}${suffix}`;
}

function groupedForeignKeys(foreignKeyRows) {
  const groups = new Map();
  for (const row of foreignKeyRows) {
    const key = `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`;
    const group = groups.get(key) ?? {
      name: String(row.CONSTRAINT_NAME),
      table: String(row.TABLE_NAME),
      referencedTable: String(row.REFERENCED_TABLE_NAME),
      updateRule: String(row.UPDATE_RULE),
      deleteRule: String(row.DELETE_RULE),
      columns: [],
      referencedColumns: [],
    };
    group.columns.push(String(row.COLUMN_NAME));
    group.referencedColumns.push(String(row.REFERENCED_COLUMN_NAME));
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function buildCollationMigrationPlan({ schema, report, createStatements, foreignKeyRows, contract }) {
  if (!report.preflightRun || !report.preflightPassed) {
    throw new Error('A passing data preflight is required before generating a migration plan.');
  }
  const mismatchesByTable = new Map();
  for (const mismatch of report.identityMismatches) {
    const rows = mismatchesByTable.get(mismatch.table) ?? [];
    rows.push(mismatch);
    mismatchesByTable.set(mismatch.table, rows);
  }
  const defaultMismatchTables = new Set(report.tableDefaultMismatches.map(mismatch => mismatch.table));
  const changedColumns = new Set(
    report.identityMismatches.map(mismatch => `${mismatch.table}.${mismatch.column}`),
  );
  const affectedForeignKeys = groupedForeignKeys(foreignKeyRows).filter(foreignKey =>
    foreignKey.columns.some(column => changedColumns.has(`${foreignKey.table}.${column}`))
      || foreignKey.referencedColumns.some(column =>
        changedColumns.has(`${foreignKey.referencedTable}.${column}`),
      ),
  );
  const dropForeignKeys = affectedForeignKeys.map(foreignKey =>
    `ALTER TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.table)} DROP FOREIGN KEY ${quoteIdentifier(foreignKey.name)};`,
  );
  const addForeignKeys = affectedForeignKeys.map(foreignKey => {
    const columns = foreignKey.columns.map(quoteIdentifier).join(', ');
    const referencedColumns = foreignKey.referencedColumns.map(quoteIdentifier).join(', ');
    return `ALTER TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.table)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.referencedTable)} (${referencedColumns}) ON DELETE ${foreignKey.deleteRule} ON UPDATE ${foreignKey.updateRule};`;
  });

  const changedTables = [...new Set([
    ...mismatchesByTable.keys(),
    ...defaultMismatchTables,
  ])].sort();
  const alterTables = changedTables.map(table => {
    const clauses = [];
    if (defaultMismatchTables.has(table)) {
      clauses.push(`DEFAULT CHARACTER SET ${contract.characterSet} COLLATE ${contract.textCollation}`);
    }
    const createStatement = createStatements[table];
    for (const mismatch of (mismatchesByTable.get(table) ?? []).sort((left, right) =>
      left.column.localeCompare(right.column),
    )) {
      if (!createStatement) throw new Error(`Missing SHOW CREATE TABLE for ${table}.`);
      clauses.push(`MODIFY COLUMN ${buildBinaryColumnDefinition({
        createStatement,
        column: mismatch.column,
        columnType: mismatch.columnType,
        contract,
      })}`);
    }
    return `ALTER TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}\n  ${clauses.join(',\n  ')};`;
  });

  const statements = [...dropForeignKeys, ...alterTables, ...addForeignKeys];
  return {
    schema,
    contractVersion: contract.version,
    sourceMetadataHash: report.metadataHash,
    planHash: createHash('sha256').update(JSON.stringify(statements)).digest('hex'),
    generatedAt: new Date().toISOString(),
    counts: {
      foreignKeysToRecreate: affectedForeignKeys.length,
      tablesToAlter: alterTables.length,
      identityColumnsToAlter: report.identityMismatches.length,
      tableDefaultsToAlter: report.tableDefaultMismatches.length,
    },
    statements,
  };
}