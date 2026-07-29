import { describe, expect, it } from 'vitest';
import type { GoogleCampaignSetting } from '../executionPreflight';
import { planGoogleBudgetRollbackPreflight, rollbackPreflightFingerprint } from '../rollbackPreflight';

const after: GoogleCampaignSetting = {
  customerId: '1112223333', currencyCode: 'AUD', campaignId: '123', campaignName: 'Search AU',
  status: 'ENABLED', budgetId: '456', budgetName: 'Search budget', amountMicros: 92_000_000,
  explicitlyShared: false, referenceCount: 1,
};
const base = {
  originalExecutionId: 9,
  expectedCustomerId: '111-222-3333',
  beforeValues: [{ campaignId: '123', budgetId: '456', amountMicros: 100_000_000, currencyCode: 'AUD' }],
  verifiedAfterValues: [after],
  liveCampaigns: [after],
  checkedAt: '2026-07-29T10:00:00.000Z',
};

describe('Google budget rollback preflight', () => {
  it('prepares an exact restoration only from stored verified states', () => {
    const result = planGoogleBudgetRollbackPreflight(base);
    expect(result).toMatchObject({ ready: true, executable: false, originalExecutionId: 9 });
    expect(result.changes[0]).toMatchObject({
      budgetId: '456', currentAmountMicros: 92_000_000,
      proposedAmountMicros: 100_000_000, operation: 'restore_campaign_budget',
    });
    expect(result.confirmationFingerprint).toBe(rollbackPreflightFingerprint(result));
  });

  it('blocks when live budget changed after the verified execution', () => {
    const result = planGoogleBudgetRollbackPreflight({
      ...base, liveCampaigns: [{ ...after, amountMicros: 95_000_000 }],
    });
    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('live_after_diverged');
  });

  it('blocks budgets that became shared', () => {
    const result = planGoogleBudgetRollbackPreflight({
      ...base, liveCampaigns: [{ ...after, explicitlyShared: true, referenceCount: 2 }],
    });
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe('shared_campaign_budget');
  });

  it('binds confirmation to exact values but not the check timestamp', () => {
    const first = planGoogleBudgetRollbackPreflight(base);
    const later = { ...first, checkedAt: '2026-07-29T10:02:00.000Z' };
    expect(rollbackPreflightFingerprint(later)).toBe(rollbackPreflightFingerprint(first));
    expect(rollbackPreflightFingerprint({
      ...later,
      changes: later.changes.map((change) => ({ ...change, proposedAmountMicros: 101_000_000 })),
    })).not.toBe(rollbackPreflightFingerprint(first));
  });
});