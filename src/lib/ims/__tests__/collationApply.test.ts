import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import contract from '../../../../scripts/collation-contract.json';
import {
  expectedApplyConfirmation,
  loadJournaledCollationPlan,
  operationSatisfied,
  validateApplyRequest,
  validateApplyTenant,
} from '../../../../scripts/lib/collation-apply.mjs';

const planHash = 'a'.repeat(64);
const metadataHash = 'b'.repeat(64);

function plan() {
  const operations = [{
    kind: 'alter_table_collations',
    table: 'ims_products',
    updateTableDefault: true,
    identityColumns: ['business_id'],
    statement: 'ALTER TABLE `readyedu_TestIMS`.`ims_products` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci, MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;',
  }];
  const statements = operations.map(operation => operation.statement);
  return {
    schema: 'readyedu_TestIMS',
    contractVersion: 2,
    sourceMetadataHash: metadataHash,
    planHash,
    operations,
    statements,
  };
}

describe('collation apply safeguards', () => {
  it('requires explicit production approval while retaining the sandbox pause gate', () => {
    expect(() => validateApplyTenant({
      business: { is_sandbox: 0, automation_paused: 0 },
      productionConfirmed: false,
    })).toThrow('production confirmation');
    expect(() => validateApplyTenant({
      business: { is_sandbox: 0, automation_paused: 0 },
      productionConfirmed: true,
    })).not.toThrow();
    expect(() => validateApplyTenant({
      business: { is_sandbox: 1, automation_paused: 0 },
      productionConfirmed: true,
    })).toThrow('automation_paused');
  });

  it('accepts an exact reviewed sandbox request', () => {
    const reviewedPlan = plan();
    reviewedPlan.planHash = createHash('sha256')
      .update(JSON.stringify(reviewedPlan.statements))
      .digest('hex');
    expect(() => validateApplyRequest({
      schema: reviewedPlan.schema,
      plan: reviewedPlan,
      expectedMetadataHash: metadataHash,
      expectedPlanHash: reviewedPlan.planHash,
      confirmation: expectedApplyConfirmation(reviewedPlan.schema, reviewedPlan.planHash),
      backupReference: 'backup-verified-2026-10-06',
      maintenanceConfirmed: true,
    })).not.toThrow();
  });

  it('requires maintenance, backup, reviewed hashes, and the exact confirmation token', () => {
    const reviewedPlan = plan();
    expect(() => validateApplyRequest({
      schema: reviewedPlan.schema,
      plan: reviewedPlan,
      expectedMetadataHash: metadataHash,
      expectedPlanHash: planHash,
      confirmation: expectedApplyConfirmation(reviewedPlan.schema, planHash),
      backupReference: 'backup-verified-2026-10-06',
      maintenanceConfirmed: false,
    })).toThrow('maintenance suspension');
  });

  it('rejects plan content that does not match its hash', () => {
    const reviewedPlan = plan();
    expect(() => validateApplyRequest({
      schema: reviewedPlan.schema,
      plan: reviewedPlan,
      expectedMetadataHash: metadataHash,
      expectedPlanHash: planHash,
      confirmation: expectedApplyConfirmation(reviewedPlan.schema, planHash),
      backupReference: 'backup-verified-2026-10-06',
      maintenanceConfirmed: true,
    })).toThrow('statements do not match');
  });

  it('reconciles an already-applied table collation operation', async () => {
    const connection = {
      query: vi.fn()
        .mockResolvedValueOnce([[{ TABLE_COLLATION: contract.textCollation }], []])
        .mockResolvedValueOnce([[
          { COLUMN_NAME: 'business_id', COLLATION_NAME: contract.identityCollation },
        ], []]),
    };
    await expect(operationSatisfied(connection, 'readyedu_TestIMS', {
      kind: 'alter_table_collations',
      table: 'ims_products',
      updateTableDefault: true,
      identityColumns: ['business_id'],
    }, contract)).resolves.toBe(true);
  });

  it('distinguishes missing and present foreign keys during resume', async () => {
    const foreignKey = {
      table: 'ims_product_variants',
      name: 'fk_variant_product',
      referencedTable: 'ims_products',
      updateRule: 'RESTRICT',
      deleteRule: 'CASCADE',
      columns: ['product_id'],
      referencedColumns: ['product_id'],
    };
    const connection = {
      query: vi.fn()
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[
          {
            COLUMN_NAME: 'product_id',
            REFERENCED_TABLE_NAME: 'ims_products',
            REFERENCED_COLUMN_NAME: 'product_id',
            ORDINAL_POSITION: 1,
            UPDATE_RULE: 'RESTRICT',
            DELETE_RULE: 'CASCADE',
          },
        ], []]),
    };
    await expect(operationSatisfied(connection, 'readyedu_TestIMS', {
      kind: 'drop_foreign_key', table: foreignKey.table, foreignKey,
    }, contract)).resolves.toBe(true);
    await expect(operationSatisfied(connection, 'readyedu_TestIMS', {
      kind: 'add_foreign_key', table: foreignKey.table, foreignKey,
    }, contract)).resolves.toBe(true);
  });

  it('loads the exact original plan for interrupted-run resume', async () => {
    const reviewedPlan = plan();
    const connection = {
      query: vi.fn().mockResolvedValueOnce([[{ present: 1 }], []]),
      execute: vi.fn().mockResolvedValueOnce([[{ plan_json: JSON.stringify(reviewedPlan) }], []]),
    };
    await expect(loadJournaledCollationPlan(
      connection,
      reviewedPlan.schema,
      reviewedPlan.planHash,
    )).resolves.toEqual(reviewedPlan);
  });
});