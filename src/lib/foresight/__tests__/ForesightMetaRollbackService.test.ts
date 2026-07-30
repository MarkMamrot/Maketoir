import { describe, expect, it, vi } from 'vitest';
import { createForesightMetaRollbackService } from '../ForesightMetaRollbackService';
import { metaRollbackPreflightFingerprint, type MetaRollbackPreflightResult } from '../metaRollbackPreflight';
import type { ForesightExecutionRow } from '../repositories/ForesightExecutionRepository';

const preflight: MetaRollbackPreflightResult = {
  mode: 'meta_rollback_preflight', executable: false, ready: true,
  checkedAt: '2026-08-02T10:00:00.000Z', confirmationFingerprint: null, originalExecutionId: 19,
  account: { source: 'meta_ads', accountId: '123', currencyCode: 'AUD' }, blockers: [],
  changes: [{ source: 'meta_ads', entityType: 'adset', entityId: 'adset-1', entityName: 'Broad', campaignId: 'campaign-1', currencyCode: 'AUD', currentDailyBudgetMinor: 4_600, proposedDailyBudgetMinor: 5_000, operation: 'restore_daily_budget' }],
};
preflight.confirmationFingerprint = metaRollbackPreflightFingerprint(preflight);

function execution(state: ForesightExecutionRow['state']): ForesightExecutionRow {
  return {
    id: 20, business_id: 'business-1', recommendation_id: 12, approval_id: 4, idempotency_key: 'rollback-key', state,
    before_json: {}, request_json: { platform: 'meta_ads', changes: preflight.changes }, response_json: null, after_json: null,
    error_text: null, compensates_execution_id: 19, created_at: '2026-08-02T10:00:00.000Z', completed_at: state === 'in_progress' ? null : '2026-08-02T10:01:00.000Z',
  };
}

function settings(budget = 5_000) {
  return {
    account: { accountId: '123', accountStatus: 1, currencyCode: 'AUD' }, campaigns: [],
    adSets: [{ accountId: '123', adSetId: 'adset-1', adSetName: 'Broad', campaignId: 'campaign-1', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: budget, lifetimeBudgetMinor: null }],
  };
}

function setup() {
  const updateDailyBudgets = vi.fn().mockResolvedValue([{ success: true }]);
  const getBudgetSettings = vi.fn().mockResolvedValue(settings());
  const findExecution = vi.fn().mockResolvedValue(null);
  const claimCompensation = vi.fn().mockResolvedValue({ created: true, execution: execution('in_progress') });
  const completeCompensation = vi.fn().mockImplementation(async input => ({ ...execution(input.state), error_text: input.errorText }));
  const service = createForesightMetaRollbackService({
    preflight: vi.fn().mockResolvedValue(preflight), findExecution, claimCompensation, completeCompensation,
    createMetaClient: vi.fn().mockResolvedValue({ updateDailyBudgets, getBudgetSettings }),
  });
  return { service, findExecution, claimCompensation, completeCompensation, updateDailyBudgets, getBudgetSettings };
}

const input = { businessId: 'business-1', recommendationId: 12, originalExecutionId: 19, actorId: 7, proposalHash: 'proposal', confirmationFingerprint: metaRollbackPreflightFingerprint(preflight) };

describe('ForesightMetaRollbackService', () => {
  it('restores the exact original budget and verifies by read-back', async () => {
    const context = setup();
    const result = await context.service.rollback(input);
    expect(context.updateDailyBudgets).toHaveBeenCalledWith([{ entityType: 'adset', entityId: 'adset-1', dailyBudgetMinor: 5_000 }]);
    expect(context.completeCompensation).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded', platform: 'meta_ads' }));
    expect(result).toMatchObject({ mutationSubmitted: true, idempotentReplay: false });
  });

  it('rejects stale confirmation before claiming or restoring', async () => {
    const context = setup();
    await expect(context.service.rollback({ ...input, confirmationFingerprint: 'stale' })).rejects.toThrow('settings changed');
    expect(context.claimCompensation).not.toHaveBeenCalled();
    expect(context.updateDailyBudgets).not.toHaveBeenCalled();
  });

  it('reconciles an in-progress rollback without replaying its mutation', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('in_progress'));
    const result = await context.service.rollback(input);
    expect(result).toMatchObject({ mutationSubmitted: false, idempotentReplay: true });
    expect(context.updateDailyBudgets).not.toHaveBeenCalled();
    expect(context.getBudgetSettings).toHaveBeenCalledOnce();
  });
});
