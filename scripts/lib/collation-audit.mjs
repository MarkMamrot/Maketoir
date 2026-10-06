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

export function buildCollationAuditReport({ schema, columnRows, tableRows, contract }) {
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
    },
    compliant: identityMismatches.length === 0 && tableDefaultMismatches.length === 0,
    identityMismatches,
    tableDefaultMismatches,
  };
}