import { describe, expect, it } from 'vitest';
import { metaRollbackPreflightFingerprint, planMetaBudgetRollbackPreflight } from '../metaRollbackPreflight';

const original = {
  source: 'meta_ads' as const, entityType: 'adset' as const, entityId: 'adset-1', entityName: 'Broad',
  campaignId: 'campaign-1', currencyCode: 'AUD', currentDailyBudgetMinor: 5_000,
  proposedDailyBudgetMinor: 4_600, reductionPercent: 8, operation: 'preview_daily_budget_reduction' as const,
};
const settings = {
  account: { accountId: '123', accountStatus: 1, currencyCode: 'AUD' },
  campaigns: [{ accountId: '123', campaignId: 'campaign-1', campaignName: 'Prospecting', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: null, lifetimeBudgetMinor: null }],
  adSets: [{ accountId: '123', adSetId: 'adset-1', adSetName: 'Broad', campaignId: 'campaign-1', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: 4_600, lifetimeBudgetMinor: null }],
};

describe('Meta budget rollback preflight', () => {
  it('prepares an exact restoration when live budget still matches verified execution', () => {
    const result = planMetaBudgetRollbackPreflight({
      originalExecutionId: 19, expectedAccountId: '123', originalChanges: [original],
      liveSettings: settings, checkedAt: '2026-08-02T10:00:00.000Z',
    });
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({ currentDailyBudgetMinor: 4_600, proposedDailyBudgetMinor: 5_000 });
    expect(result.confirmationFingerprint).toBe(metaRollbackPreflightFingerprint(result));
  });

  it('blocks rollback when the live budget changed after execution', () => {
    const result = planMetaBudgetRollbackPreflight({
      originalExecutionId: 19, expectedAccountId: '123', originalChanges: [original],
      liveSettings: { ...settings, adSets: [{ ...settings.adSets[0], dailyBudgetMinor: 4_800 }] },
      checkedAt: '2026-08-02T10:00:00.000Z',
    });
    expect(result.ready).toBe(false);
    expect(result.confirmationFingerprint).toBeNull();
    expect(result.blockers[0].code).toBe('meta_live_after_diverged');
  });

  it('blocks rollback when the connected account differs from the receipt', () => {
    const result = planMetaBudgetRollbackPreflight({
      originalExecutionId: 19, expectedAccountId: '999', originalChanges: [original],
      liveSettings: settings, checkedAt: '2026-08-02T10:00:00.000Z',
    });
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe('meta_account_mismatch');
  });
});