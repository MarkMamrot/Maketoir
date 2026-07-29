import { describe, expect, it, vi } from 'vitest';
import { createForesightExecutionService } from '../ForesightExecutionService';
import type { ExecutionPreflightResult } from '../executionPreflight';
import { executionPreflightFingerprint } from '../executionPreflight';
import type { ForesightExecutionRow } from '../repositories/ForesightExecutionRepository';

const preflight: ExecutionPreflightResult = {
  mode: 'read_only_preflight', executable: false, ready: true,
  checkedAt: '2026-07-29T10:00:00.000Z', confirmationFingerprint: null,
  account: { source: 'google_ads', customerId: '1112223333' }, blockers: [],
  changes: [{
    source: 'google_ads', entityType: 'campaign_budget', campaignId: '123',
    campaignName: 'Search AU', budgetId: '456', budgetName: 'Search budget',
    currencyCode: 'AUD', currentAmountMicros: 100_000_000,
    proposedAmountMicros: 92_000_000, reductionPercent: 8,
    operation: 'update_campaign_budget',
  }],
};

function execution(state: ForesightExecutionRow['state']): ForesightExecutionRow {
  return {
    id: 9, business_id: 'business-1', recommendation_id: 12, approval_id: 4,
    idempotency_key: 'key', state,
    before_json: { campaigns: preflight.changes },
    request_json: { changes: preflight.changes }, response_json: null, after_json: null,
    error_text: null, compensates_execution_id: null,
    created_at: '2026-07-29T10:00:00.000Z', completed_at: state === 'in_progress' ? null : '2026-07-29T10:01:00.000Z',
  };
}

function setup() {
  const updateCampaignBudgets = vi.fn().mockResolvedValue({ mutate_operation_responses: [{}] });
  const getCampaignSettings = vi.fn().mockResolvedValue([{
    customer: { id: '1112223333', currency_code: 'AUD' },
    campaign: { id: '123', name: 'Search AU', status: 'ENABLED' },
    campaign_budget: {
      id: '456', name: 'Search budget', amount_micros: 92_000_000,
      explicitly_shared: false, reference_count: 1,
    },
  }]);
  const findExecution = vi.fn().mockResolvedValue(null);
  const claimExecution = vi.fn().mockResolvedValue({ created: true, execution: execution('in_progress') });
  const completeExecution = vi.fn().mockImplementation(async (input) => ({
    ...execution(input.state), response_json: input.response, after_json: input.after,
    error_text: input.errorText,
  }));
  const service = createForesightExecutionService({
    preflight: vi.fn().mockResolvedValue(preflight), findExecution, claimExecution,
    completeExecution, createGoogleClient: vi.fn().mockResolvedValue({ updateCampaignBudgets, getCampaignSettings }),
  });
  return { service, findExecution, claimExecution, completeExecution, updateCampaignBudgets, getCampaignSettings };
}

const input = {
  businessId: 'business-1', recommendationId: 12, actorId: 7,
  proposalHash: 'proposal', confirmationFingerprint: executionPreflightFingerprint(preflight),
};

describe('ForesightExecutionService', () => {
  it('submits the exact server-preflighted budget and succeeds only after read-back', async () => {
    const context = setup();
    const result = await context.service.execute(input);

    expect(context.updateCampaignBudgets).toHaveBeenCalledWith([{ budgetId: '456', amountMicros: 92_000_000 }]);
    expect(context.completeExecution).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded', errorText: null }));
    expect(result.execution.state).toBe('succeeded');
    expect(result.mutationSubmitted).toBe(true);
  });

  it('rejects a stale exact-state confirmation before claiming or mutating', async () => {
    const context = setup();
    await expect(context.service.execute({ ...input, confirmationFingerprint: 'stale' }))
      .rejects.toThrow('settings changed');
    expect(context.claimExecution).not.toHaveBeenCalled();
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
  });

  it('returns a completed idempotent receipt without calling Google again', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('succeeded'));

    const result = await context.service.execute(input);

    expect(result.idempotentReplay).toBe(true);
    expect(result.mutationSubmitted).toBe(false);
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
    expect(context.claimExecution).not.toHaveBeenCalled();
  });

  it('never replays an in-progress mutation and reconciles it by read-back only', async () => {
    const context = setup();
    context.findExecution.mockResolvedValue(execution('in_progress'));

    const result = await context.service.execute(input);

    expect(result.execution.state).toBe('succeeded');
    expect(result.mutationSubmitted).toBe(false);
    expect(context.updateCampaignBudgets).not.toHaveBeenCalled();
    expect(context.getCampaignSettings).toHaveBeenCalledOnce();
  });
});