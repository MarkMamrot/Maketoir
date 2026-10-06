import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import contract from '../../../../scripts/collation-contract.json';
import { buildCollationAuditReport, validateCollationContract } from '../../../../scripts/lib/collation-audit.mjs';
import { buildBinaryColumnDefinition, buildCollationMigrationPlan } from '../../../../scripts/lib/collation-plan.mjs';

describe('collation audit', () => {
  it('rejects an ambiguous identity contract', () => {
    expect(() => validateCollationContract({
      ...contract,
      tenantIdentityColumns: ['business_id', 'business_id'],
    })).toThrow('contains duplicates');
  });

  it('rejects duplicate relationship definitions', () => {
    expect(() => validateCollationContract({
      ...contract,
      relationships: [contract.relationships[0], contract.relationships[0]],
    })).toThrow('Duplicate collation relationship');
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
      preflightRun: true,
      ownershipChecks: [{
        table: 'ims_products',
        status: 'ok',
        exactMismatches: 20,
        caseOnlyMismatches: 1,
      }],
      relationshipChecks: [{
        ...contract.relationships[0],
        status: 'ok',
        exactOrphans: 2,
        caseOnlyMatches: 1,
      }],
    });

    expect(report.compliant).toBe(false);
    expect(report.counts).toMatchObject({
      tables: 1,
      identityColumns: 2,
      identityMismatches: 1,
      tableDefaultMismatches: 1,
      ownershipMismatches: 1,
      relationshipIssues: 1,
    });
    expect(report.preflightPassed).toBe(false);
    expect(report.identityMismatches[0]).toMatchObject({
      table: 'ims_products',
      column: 'business_id',
      targetCollation: 'utf8mb4_bin',
    });
    expect(report.tableDefaultMismatches[0]).toMatchObject({ estimatedBytes: 1500 });
    expect(report.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not block on pre-existing unrelated owners or exact orphans', () => {
    const report = buildCollationAuditReport({
      schema: 'readyedu_TestIMS',
      contract,
      columnRows: [],
      tableRows: [],
      preflightRun: true,
      ownershipChecks: [{
        table: 'pos_sales',
        status: 'ok',
        exactMismatches: 200,
        caseOnlyMismatches: 0,
      }],
      relationshipChecks: [{
        ...contract.relationships[0],
        status: 'ok',
        exactOrphans: 12,
        caseOnlyMatches: 0,
      }],
    });

    expect(report.preflightPassed).toBe(true);
    expect(report.counts).toMatchObject({ ownershipMismatches: 0, relationshipIssues: 0 });
  });
});

describe('collation migration planning', () => {
  it('preserves a SHOW CREATE column definition while replacing its collation', () => {
    const definition = buildBinaryColumnDefinition({
      createStatement: `CREATE TABLE \`ims_products\` (\n  \`business_id\` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',\n  PRIMARY KEY (\`business_id\`)\n) ENGINE=InnoDB`,
      column: 'business_id',
      columnType: 'varchar(100)',
      contract,
    });

    expect(definition).toBe(
      "`business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT ''",
    );
  });

  it('brackets altered identity columns with foreign-key recreation', () => {
    const report = buildCollationAuditReport({
      schema: 'readyedu_TestIMS',
      contract,
      columnRows: [{
        TABLE_NAME: 'ims_product_variants',
        COLUMN_NAME: 'product_id',
        COLUMN_TYPE: 'varchar(36)',
        IS_NULLABLE: 'NO',
        COLUMN_DEFAULT: null,
        EXTRA: '',
        COLLATION_NAME: 'utf8mb4_general_ci',
      }],
      tableRows: [{
        TABLE_NAME: 'ims_product_variants',
        TABLE_COLLATION: 'utf8mb4_general_ci',
        TABLE_ROWS: 1,
        DATA_LENGTH: 100,
        INDEX_LENGTH: 100,
      }],
      preflightRun: true,
      ownershipChecks: [],
      relationshipChecks: [],
    });
    const plan = buildCollationMigrationPlan({
      schema: 'readyedu_TestIMS',
      report,
      contract,
      createStatements: {
        ims_product_variants: `CREATE TABLE \`ims_product_variants\` (\n  \`product_id\` varchar(36) NOT NULL\n) ENGINE=InnoDB`,
      },
      foreignKeyRows: [{
        CONSTRAINT_NAME: 'fk_variant_product',
        TABLE_NAME: 'ims_product_variants',
        COLUMN_NAME: 'product_id',
        REFERENCED_TABLE_NAME: 'ims_products',
        REFERENCED_COLUMN_NAME: 'product_id',
        ORDINAL_POSITION: 1,
        UPDATE_RULE: 'RESTRICT',
        DELETE_RULE: 'CASCADE',
      }],
    });

    expect(plan.counts).toEqual({
      foreignKeysToRecreate: 1,
      tablesToAlter: 1,
      identityColumnsToAlter: 1,
      tableDefaultsToAlter: 1,
    });
    expect(plan.statements[0]).toContain('DROP FOREIGN KEY `fk_variant_product`');
    expect(plan.statements[1]).toContain('DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    expect(plan.statements[1]).toContain('COLLATE utf8mb4_bin NOT NULL');
    expect(plan.statements[2]).toContain('ADD CONSTRAINT `fk_variant_product`');
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the retired broad converter non-operational', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'fix-all-collations.mjs'), 'utf8');
    expect(source).not.toContain('ALTER TABLE');
    expect(source).not.toContain('CONVERT TO CHARACTER SET');
    expect(source).toContain('migrate-collations-all-tenants.mjs');
  });
});