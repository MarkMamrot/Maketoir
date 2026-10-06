import { describe, expect, it } from 'vitest';

import contract from '../../../../scripts/collation-contract.json';
import { buildCollationAuditReport, validateCollationContract } from '../../../../scripts/lib/collation-audit.mjs';

describe('collation audit', () => {
  it('rejects an ambiguous identity contract', () => {
    expect(() => validateCollationContract({
      ...contract,
      tenantIdentityColumns: ['business_id', 'business_id'],
    })).toThrow('contains duplicates');
  });

  it('reports only contracted identity and table-default drift', () => {
    const report = buildCollationAuditReport({
      schema: 'readyedu_TestIMS',
      contract,
      columnRows: [
        {
          TABLE_NAME: 'ims_products',
          COLUMN_NAME: 'business_id',
          COLUMN_TYPE: 'varchar(100)',
          IS_NULLABLE: 'NO',
          COLUMN_DEFAULT: '',
          EXTRA: '',
          COLLATION_NAME: 'utf8mb4_general_ci',
        },
        {
          TABLE_NAME: 'ims_products',
          COLUMN_NAME: 'product_id',
          COLUMN_TYPE: 'varchar(36)',
          IS_NULLABLE: 'NO',
          COLUMN_DEFAULT: null,
          EXTRA: '',
          COLLATION_NAME: 'utf8mb4_bin',
        },
      ],
      tableRows: [
        {
          TABLE_NAME: 'ims_products',
          TABLE_COLLATION: 'utf8mb4_0900_ai_ci',
          TABLE_ROWS: 12,
          DATA_LENGTH: 1000,
          INDEX_LENGTH: 500,
        },
      ],
    });

    expect(report.compliant).toBe(false);
    expect(report.counts).toMatchObject({
      tables: 1,
      identityColumns: 2,
      identityMismatches: 1,
      tableDefaultMismatches: 1,
    });
    expect(report.identityMismatches[0]).toMatchObject({
      table: 'ims_products',
      column: 'business_id',
      targetCollation: 'utf8mb4_bin',
    });
    expect(report.tableDefaultMismatches[0]).toMatchObject({ estimatedBytes: 1500 });
    expect(report.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  });
});