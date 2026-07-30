import { describe, expect, it } from 'vitest';
import type { PaidMediaContributorEvidence } from '../types';
import {
  executionPreflightFingerprint,
  planGoogleBudgetIncreasePreflight,
  planGoogleBudgetReductionPreflight,
  type GoogleCampaignSetting,
} from '../executionPreflight';

const contributor: PaidMediaContributorEvidence = {
  source: 'google_ads', entityType: 'campaign', entityId: '123', entityName: 'Search AU',
  parentEntityId: null, parentEntityName: null, currentSpend: 500, previousSpend: 300,
  spendChange: 200, currentAttributedRevenue: 100, previousAttributedRevenue: 900,
  currentPlatformRoas: 0.2, previousPlatformRoas: 3, platformRoasChangePercent: -93.3,
  diagnosticScore: 10, signals: ['platform_roas_decline'],
};
const live: GoogleCampaignSetting = {
  customerId: '1112223333', currencyCode: 'AUD', campaignId: '123', campaignName: 'Search AU',
  status: 'ENABLED', budgetId: '456', budgetName: 'Search budget', amountMicros: 100_000_000,
  explicitlyShared: false, referenceCount: 1,
};

describe('Google budget reduction preflight', () => {
  it('prepares an exact capped read-only change from live account state', () => {
    const result = planGoogleBudgetReductionPreflight({
      contributors: [contributor], liveCampaigns: [live], maximumReductionPercent: 8,
      expectedCustomerId: '111-222-3333', checkedAt: '2026-07-29T10:00:00.000Z',
    });

    expect(result).toMatchObject({ mode: 'read_only_preflight', executable: false, ready: true });
    expect(result.changes[0]).toMatchObject({
      campaignId: '123', budgetId: '456', currentAmountMicros: 100_000_000,
      proposedAmountMicros: 92_000_000, reductionPercent: 8,
    });
  });

  it('blocks shared budgets rather than risking other campaigns', () => {
    const result = planGoogleBudgetReductionPreflight({
      contributors: [contributor], liveCampaigns: [{ ...live, explicitlyShared: true, referenceCount: 3 }],
      maximumReductionPercent: 8, expectedCustomerId: '1112223333', checkedAt: '2026-07-29T10:00:00.000Z',
    });
    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('shared_campaign_budget');
  });

  it('does not prepare Meta or ad-set changes from diagnostic evidence', () => {
    const result = planGoogleBudgetReductionPreflight({
      contributors: [{ ...contributor, source: 'meta_ads', entityType: 'adset' }],
      liveCampaigns: [], maximumReductionPercent: 8, expectedCustomerId: '1112223333',
      checkedAt: '2026-07-29T10:00:00.000Z',
    });
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe('no_supported_google_campaign_candidates');
  });

  it('binds confirmation to exact live before and proposed values, not check time', () => {
    const first = planGoogleBudgetReductionPreflight({
      contributors: [contributor], liveCampaigns: [live], maximumReductionPercent: 8,
      expectedCustomerId: '1112223333', checkedAt: '2026-07-29T10:00:00.000Z',
    });
    const later = { ...first, checkedAt: '2026-07-29T10:01:00.000Z' };
    const changed = {
      ...later,
      changes: later.changes.map((change) => ({ ...change, currentAmountMicros: 110_000_000 })),
    };

    expect(executionPreflightFingerprint(later)).toBe(executionPreflightFingerprint(first));
    expect(executionPreflightFingerprint(changed)).not.toBe(executionPreflightFingerprint(first));
  });
});

describe('Google budget increase preflight', () => {
  it('prepares an exact increase capped at ten percent from live account state', () => {
    const result = planGoogleBudgetIncreasePreflight({
      contributors: [{ ...contributor, currentAttributedRevenue: 900, signals: [] }],
      liveCampaigns: [live], maximumIncreasePercent: 25,
      expectedCustomerId: '111-222-3333', checkedAt: '2026-07-30T10:00:00.000Z',
    });

    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({
      campaignId: '123', currentAmountMicros: 100_000_000,
      proposedAmountMicros: 110_000_000, direction: 'increase', changePercent: 10,
    });
  });

  it('blocks deteriorating campaign evidence from an increase', () => {
    const result = planGoogleBudgetIncreasePreflight({
      contributors: [contributor], liveCampaigns: [live], maximumIncreasePercent: 5,
      expectedCustomerId: '1112223333', checkedAt: '2026-07-30T10:00:00.000Z',
    });

    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('no_supported_google_campaign_candidates');
  });
});