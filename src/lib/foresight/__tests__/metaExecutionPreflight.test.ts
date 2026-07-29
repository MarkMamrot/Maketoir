import { describe, expect, it } from 'vitest';
import type { PaidMediaContributorEvidence } from '../types';
import {
  planMetaBudgetReductionPreflight,
  type MetaAdAccountSetting,
  type MetaAdSetSetting,
  type MetaCampaignSetting,
} from '../metaExecutionPreflight';

const campaignContributor: PaidMediaContributorEvidence = {
  source: 'meta_ads', entityType: 'campaign', entityId: 'campaign-1', entityName: 'Prospecting',
  parentEntityId: null, parentEntityName: null, currentSpend: 500, previousSpend: 300,
  spendChange: 200, currentAttributedRevenue: 100, previousAttributedRevenue: 900,
  currentPlatformRoas: 0.2, previousPlatformRoas: 3, platformRoasChangePercent: -93.3,
  diagnosticScore: 10, signals: ['platform_roas_decline'],
};
const account: MetaAdAccountSetting = { accountId: 'act_123', accountStatus: 1, currencyCode: 'AUD' };
const campaign: MetaCampaignSetting = {
  accountId: '123', campaignId: 'campaign-1', campaignName: 'Prospecting',
  configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: 10_000, lifetimeBudgetMinor: null,
};
const adSet: MetaAdSetSetting = {
  accountId: '123', adSetId: 'adset-1', adSetName: 'Broad', campaignId: 'campaign-1',
  configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: 5_000, lifetimeBudgetMinor: null,
};

function plan(overrides: Partial<Parameters<typeof planMetaBudgetReductionPreflight>[0]> = {}) {
  return planMetaBudgetReductionPreflight({
    contributors: [campaignContributor], account, liveCampaigns: [campaign], liveAdSets: [adSet],
    maximumReductionPercent: 8, expectedAccountId: '123', checkedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  });
}

describe('Meta budget reduction preflight', () => {
  it('prepares an exact non-executable campaign daily-budget proposal', () => {
    const result = plan();
    expect(result).toMatchObject({ mode: 'read_only_meta_preflight', executable: false, ready: true });
    expect(result.changes[0]).toMatchObject({
      entityType: 'campaign', entityId: 'campaign-1', currencyCode: 'AUD',
      currentDailyBudgetMinor: 10_000, proposedDailyBudgetMinor: 9_200, reductionPercent: 8,
    });
  });

  it('prepares an ad-set proposal only when the active parent campaign owns no budget', () => {
    const result = plan({
      contributors: [{ ...campaignContributor, entityType: 'adset', entityId: 'adset-1', entityName: 'Broad', parentEntityId: 'campaign-1', parentEntityName: 'Prospecting' }],
      liveCampaigns: [{ ...campaign, dailyBudgetMinor: null }],
    });
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({ entityType: 'adset', currentDailyBudgetMinor: 5_000, proposedDailyBudgetMinor: 4_600 });
  });

  it('blocks an ad-set proposal when its parent campaign controls budget', () => {
    const result = plan({ contributors: [{ ...campaignContributor, entityType: 'adset', entityId: 'adset-1' }] });
    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('meta_campaign_budget_controls_adset');
  });

  it('blocks lifetime budgets and inactive entities', () => {
    expect(plan({ liveCampaigns: [{ ...campaign, lifetimeBudgetMinor: 100_000 }] }).blockers[0].code)
      .toBe('meta_lifetime_budget_unsupported');
    expect(plan({ liveCampaigns: [{ ...campaign, effectiveStatus: 'PAUSED' }] }).blockers[0].code)
      .toBe('meta_campaign_not_active');
  });

  it('blocks account mismatch before preparing entity proposals', () => {
    const result = plan({ account: { ...account, accountId: 'act_999' } });
    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('meta_account_mismatch');
  });

  it('blocks proposals that round to a no-op in account minor units', () => {
    const result = plan({ liveCampaigns: [{ ...campaign, dailyBudgetMinor: 1 }] });
    expect(result.ready).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.blockers[0].code).toBe('meta_no_valid_budget_change');
  });
});