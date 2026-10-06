import { createHash } from 'node:crypto';

export function validateCollationContract(contract) {
  if (!Number.isInteger(contract?.version) || contract.version < 1) {
    throw new Error('Collation contract version must be a positive integer.');
  }
  for (const key of ['characterSet', 'textCollation', 'identityCollation']) {
    if (typeof contract[key] !== 'string' || !contract[key]) {
      throw new Error(`Collation contract ${key} is required.`);
    }
  }
  if (!Array.isArray(contract.tenantIdentityColumns) || contract.tenantIdentityColumns.length === 0) {
    throw new Error('Collation contract tenantIdentityColumns must not be empty.');
  }
  const uniqueColumns = new Set(contract.tenantIdentityColumns);
  if (uniqueColumns.size !== contract.tenantIdentityColumns.length) {
    throw new Error('Collation contract tenantIdentityColumns contains duplicates.');
  }
  if (!Array.isArray(contract.relationships) || contract.relationships.length === 0) {
    throw new Error('Collation contract relationships must not be empty.');
  }
  const identifierPattern = /^[A-Za-z0-9_]+$/;
  const relationshipKeys = new Set();
  for (const relationship of contract.relationships) {
    const values = [
      relationship?.parentTable,
      relationship?.parentColumn,
      relationship?.childTable,
      relationship?.childColumn,
    ];
    if (values.some(value => typeof value !== 'string' || !identifierPattern.test(value))) {
      throw new Error('Collation contract contains an invalid relationship identifier.');
    }
    const key = values.join('.');
    if (relationshipKeys.has(key)) throw new Error(`Duplicate collation relationship: ${key}`);
    relationshipKeys.add(key);
  }
}

function metadataHash(columnRows, tableRows) {
  const normalized = {
    columns: columnRows.map(row => ({
      table: String(row.TABLE_NAME),
      column: String(row.COLUMN_NAME),
      type: String(row.COLUMN_TYPE),
      nullable: String(row.IS_NULLABLE),
      default: row.COLUMN_DEFAULT ?? null,
      extra: String(row.EXTRA ?? ''),
      collation: row.COLLATION_NAME ?? null,
    })),
    tables: tableRows.map(row => ({
      table: String(row.TABLE_NAME),
      collation: row.TABLE_COLLATION ?? null,
      rows: Number(row.TABLE_ROWS ?? 0),
      dataBytes: Number(row.DATA_LENGTH ?? 0),
      indexBytes: Number(row.INDEX_LENGTH ?? 0),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function buildCollationAuditReport({
  schema,
  columnRows,
  tableRows,
  contract,
  ownershipChecks = [],
  relationshipChecks = [],
  preflightRun = false,
}) {
  validateCollationContract(contract);
  const identityColumns = new Set(contract.tenantIdentityColumns);
  const inspectedIdentityColumns = columnRows
    .filter(row => identityColumns.has(String(row.COLUMN_NAME)))
    .filter(row => row.COLLATION_NAME !== null)
    .map(row => ({
      table: String(row.TABLE_NAME),
      column: String(row.COLUMN_NAME),
      columnType: String(row.COLUMN_TYPE),
      collation: row.COLLATION_NAME ?? null,
      targetCollation: contract.identityCollation,
    }));
  const identityMismatches = inspectedIdentityColumns
    .filter(column => column.collation !== contract.identityCollation);
  const tableDefaultMismatches = tableRows
    .filter(row => row.TABLE_COLLATION !== contract.textCollation)
    .map(row => ({
      table: String(row.TABLE_NAME),
      collation: row.TABLE_COLLATION ?? null,
      targetCollation: contract.textCollation,
      estimatedRows: Number(row.TABLE_ROWS ?? 0),
      estimatedBytes: Number(row.DATA_LENGTH ?? 0) + Number(row.INDEX_LENGTH ?? 0),
    }));
  const blockingOwnershipChecks = ownershipChecks.filter(check => check.caseOnlyMismatches > 0);
  const blockingRelationshipChecks = relationshipChecks.filter(check =>
    check.status === 'ok' && check.caseOnlyMatches > 0,
  );
  const preflightPassed = preflightRun
    && blockingOwnershipChecks.length === 0
    && blockingRelationshipChecks.length === 0;

  return {
    schema,
    contractVersion: contract.version,
    metadataHash: metadataHash(columnRows, tableRows),
    inspectedAt: new Date().toISOString(),
    counts: {
      tables: tableRows.length,
      identityColumns: inspectedIdentityColumns.length,
      identityMismatches: identityMismatches.length,
      tableDefaultMismatches: tableDefaultMismatches.length,
      ownershipMismatches: blockingOwnershipChecks.length,
      relationshipIssues: blockingRelationshipChecks.length,
    },
    metadataCompliant: identityMismatches.length === 0 && tableDefaultMismatches.length === 0,
    preflightRun,
    preflightPassed,
    compliant: identityMismatches.length === 0
      && tableDefaultMismatches.length === 0
      && (!preflightRun || preflightPassed),
    identityMismatches,
    tableDefaultMismatches,
    ownershipChecks,
    relationshipChecks,
  };
}