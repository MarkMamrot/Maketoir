import { describe, expect, it, vi } from 'vitest';
import { createForesightMetaExecutionService } from '../ForesightMetaExecutionService';
import { metaExecutionPreflightFingerprint, type MetaExecutionPreflightResult } from '../metaExecutionPreflight';
import type { ForesightExecutionRow } from '../repositories/ForesightExecutionRepository';

const preflight: MetaExecutionPreflightResult = {
  mode: 'read_only_meta_preflight', executable: false, ready: true,
  checkedAt: '2026-08-01T10:00:00.000Z', confirmationFingerprint: null,
  account: { source: 'meta_ads', accountId: '123', currencyCode: 'AUD' }, blockers: [],
  changes: [{
    source: 'meta_ads', entityType: 'adset', entityId: 'adset-1', entityName: 'Broad',
    campaignId: 'campaign-1', currencyCode: 'AUD', currentDailyBudgetMinor: 5_000,
    proposedDailyBudgetMinor: 4_600, reductionPercent: 8, operation: 'preview_daily_budget_reduction',
  }],
};
preflight.confirmationFingerprint = metaExecutionPreflightFingerprint(preflight);

function execution(state: ForesightExecutionRow['state']): ForesightExecutionRow {
  return {
    id: 19, business_id: 'business-1', recommendation_id: 12, approval_id: 4,
    idempotency_key: 'key', state,
    before_json: { changes: preflight.changes }, request_json: { platform: 'meta_ads', changes: preflight.changes },
    response_json: null, after_json: null, error_text: null, compensates_execution_id: null,
    created_at: '2026-08-01T10:00:00.000Z', completed_at: state === 'in_progress' ? null : '2026-08-01T10:01:00.000Z',
  };
}

function settings(dailyBudgetMinor = 4_600) {
  return {
    account: { accountId: '123', accountStatus: 1, currencyCode: 'AUD' },
    campaigns: [{ accountId: '123', campaignId: 'campaign-1', campaignName: 'Prospecting', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: null, lifetimeBudgetMinor: null }],
    adSets: [{ accountId: '123', adSetId: 'adset-1', adSetName: 'Broad', campaignId: 'campaign-1', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor, lifetimeBudgetMinor: null }],
  };
}

function setup() {
  const updateDailyBudgets = vi.fn().mockResolvedValue([{ success: true }]);
  const getBudgetSettings = vi.fn().mockResolvedValue(settings());
  const findExecution = vi.fn().mockResolvedValue(null);
  const claimExecution = vi.fn().mockResolvedValue({ created: true, execution: execution('in_progress') });
  const completeExecution = vi.fn().mockImplementation(async input => ({
    ...execution(input.state), response_json: input.response, after_json: input.after, error_text: input.errorText,
  }));
  const notifyBudgetChange = vi.fn().mockResolvedValue(undefined);
  const service = createForesightMetaExecutionService({
    preflight: vi.fn().mockResolvedValue(preflight), findExecution, claimExecution, completeExecution,
    createMetaClient: vi.fn().mockResolvedValue({ updateDailyBudgets, getBudgetSettings }), notifyBudgetChange,
  });
  return { service, findExecution, claimExecution, completeExecution, updateDailyBudgets, getBudgetSettings, notifyBudgetChange };
}

const input = {
  businessId: 'business-1', recommendationId: 12, actorId: 7,
  proposalHash: 'proposal', confirmationFingerprint: metaExecutionPreflightFingerprint(preflight),
};

describe('ForesightMetaExecutionService', () => {
  it('submits the exact server-preflighted Meta budget and succeeds only after read-back', async () => {
    const context = setup();
    const result = await context.service.execute(input);

    expect(context.updateDailyBudgets).toHaveBeenCalledWith([
      { entityType: 'adset', entityId: 'adset-1', dailyBudgetMinor: 4_600 },
    ]);
    expect(context.completeExecution).toHaveBeenCalledWith(expect.objectContaining({
      state: 'succeeded', errorText: null, platform: 'meta_ads',
    }));
    expect(result).toMatchObject({ mutationSubmitted: true, notification: 'sent' });
  });

  it('rejects stale exact-state confirmation before claiming or mutating', async () => {
    const context = setup();
    await expect(context.service.execute({ ...input, confirmationFingerprint: 'stale' }))
      .rejects.toThrow('settings changed');
    expect(context.claimExecution).not.toHaveBeenCalled();
    expect(context.updateDailyBudgets).not.toHaveBeenCalled();
  });

  it('does not repeat a completed Meta mutation on idempotent replay', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('succeeded'));

    const result = await context.service.execute(input);

    expect(result).toMatchObject({ idempotentReplay: true, mutationSubmitted: false, notification: 'sent' });
    expect(context.updateDailyBudgets).not.toHaveBeenCalled();
    expect(context.claimExecution).not.toHaveBeenCalled();
  });

  it('reconciles an in-progress execution by read-back without replaying the mutation', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('in_progress'));

    const result = await context.service.execute(input);

    expect(result).toMatchObject({ idempotentReplay: true, mutationSubmitted: false });
    expect(context.updateDailyBudgets).not.toHaveBeenCalled();
    expect(context.getBudgetSettings).toHaveBeenCalledOnce();
  });

  it('records failure when mutation and live read-back leave the original budget unchanged', async () => {
    const context = setup();
    context.updateDailyBudgets.mockRejectedValue(new Error('Meta rejected update'));
    context.getBudgetSettings.mockResolvedValue(settings(5_000));

    const result = await context.service.execute(input);

    expect(context.completeExecution).toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed', errorText: 'Meta rejected update', platform: 'meta_ads',
    }));
    expect(result.notification).toBe('not_sent');
  });
});
