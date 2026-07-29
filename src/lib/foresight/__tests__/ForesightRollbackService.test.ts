import { describe, expect, it, vi } from 'vitest';
import { createForesightRollbackService } from '../ForesightRollbackService';
import type { ForesightExecutionRow } from '../repositories/ForesightExecutionRepository';
import { rollbackPreflightFingerprint, type RollbackPreflightResult } from '../rollbackPreflight';

const preflight: RollbackPreflightResult = {
  mode: 'rollback_preflight', executable: false, ready: true,
  checkedAt: '2026-07-29T10:10:00.000Z', confirmationFingerprint: null,
  originalExecutionId: 9,
  account: { source: 'google_ads', customerId: '1112223333' }, blockers: [],
  changes: [{
    source: 'google_ads', entityType: 'campaign_budget', campaignId: '123',
    campaignName: 'Search AU', budgetId: '456', budgetName: 'Search budget',
    currencyCode: 'AUD', currentAmountMicros: 92_000_000,
    proposedAmountMicros: 100_000_000, operation: 'restore_campaign_budget',
  }],
};

function execution(state: ForesightExecutionRow['state']): ForesightExecutionRow {
  return {
    id: 10, business_id: 'business-1', recommendation_id: 12, approval_id: 4,
    idempotency_key: 'rollback-key', state,
    before_json: { campaigns: [] }, request_json: { changes: preflight.changes },
    response_json: null, after_json: null, error_text: null,
    compensates_execution_id: 9, created_at: '2026-07-29T10:10:00.000Z',
    completed_at: state === 'in_progress' ? null : '2026-07-29T10:11:00.000Z',
  };
}

function setup() {
  const updateCampaignBudgets = vi.fn().mockResolvedValue({ mutate_operation_responses: [{}] });
  const getCampaignSettings = vi.fn().mockResolvedValue([{
    customer: { id: '1112223333', currency_code: 'AUD' },
    campaign: { id: '123', name: 'Search AU', status: 'ENABLED' },
    campaign_budget: {
      id: '456', name: 'Search budget', amount_micros: 100_000_000,
      explicitly_shared: false, reference_count: 1,
    },
  }]);
  const findExecution = vi.fn().mockResolvedValue(null);
  const claimCompensation = vi.fn().mockResolvedValue({ created: true, execution: execution('in_progress') });
  const completeCompensation = vi.fn().mockImplementation(async (input) => ({
    ...execution(input.state), response_json: input.response, after_json: input.after,
    error_text: input.errorText,
  }));
  const service = createForesightRollbackService({
    preflight: vi.fn().mockResolvedValue(preflight), findExecution, claimCompensation,
    completeCompensation, createGoogleClient: vi.fn().mockResolvedValue({ updateCampaignBudgets, getCampaignSettings }),
  });
  return { service, findExecution, claimCompensation, completeCompensation, updateCampaignBudgets, getCampaignSettings };
}

const input = {
  businessId: 'business-1', recommendationId: 12, originalExecutionId: 9, actorId: 7,
  proposalHash: 'proposal', confirmationFingerprint: rollbackPreflightFingerprint(preflight),
};

describe('ForesightRollbackService', () => {
  it('restores exact stored budgets and succeeds only after live read-back', async () => {
    const context = setup();
    const result = await context.service.rollback(input);
    expect(context.updateCampaignBudgets).toHaveBeenCalledWith([{ budgetId: '456', amountMicros: 100_000_000 }]);
    expect(context.completeCompensation).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded', errorText: null }));
    expect(result.execution.state).toBe('succeeded');
    expect(result.mutationSubmitted).toBe(true);
  });

  it('rejects stale rollback confirmation before claiming or mutating', async () => {
    const context = setup();
    await expect(context.service.rollback({ ...input, confirmationFingerprint: 'stale' }))
      .rejects.toThrow('settings changed');
    expect(context.claimCompensation).not.toHaveBeenCalled();
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
  });

  it('returns a completed compensation idempotently without another Google call', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('succeeded'));
    const result = await context.service.rollback(input);
    expect(result.idempotentReplay).toBe(true);
    expect(result.mutationSubmitted).toBe(false);
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
  });

  it('reconciles an interrupted compensation by read-back without replaying mutation', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('in_progress'));
    const result = await context.service.rollback(input);
    expect(result.execution.state).toBe('succeeded');
    expect(result.mutationSubmitted).toBe(false);
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
    expect(context.getCampaignSettings).toHaveBeenCalledOnce();
  });
});