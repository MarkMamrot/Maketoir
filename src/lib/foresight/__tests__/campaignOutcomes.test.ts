import { describe, expect, it } from 'vitest';
import { assessCampaignOutcome, summarizeCampaignOutcomeWindow } from '../campaignOutcomes';
import type { DailyCommerceReconciliation } from '../metrics/commerceReconciliation';

function row(date: string, contribution: number | null, revenue = 200): DailyCommerceReconciliation {
  return {
    metricDate: date,
    onlineNetRevenueExTax: revenue,
    posNetRevenueExTax: 0,
    onlineContribution: {
      grossProfit: { value: contribution, state: contribution == null ? 'blocked' : 'available' },
      contributionProfitBeforeAds: { value: contribution, state: contribution == null ? 'blocked' : 'available' },
      costBasis: contribution == null ? 'blocked' : 'exact',
    },
    paidMedia: { paidMediaSpend: 50, platformAttributedRevenue: 300 },
    qualityIssues: contribution == null
      ? [{ code: 'missing_cost', severity: 'blocking', message: 'Cost unavailable.' }]
      : [],
  } as DailyCommerceReconciliation;
}

function window(startDay: number, contribution: number): DailyCommerceReconciliation[] {
  return Array.from({ length: 7 }, (_, index) => row(`2026-07-${String(startDay + index).padStart(2, '0')}`, contribution));
}

describe('campaign outcomes', () => {
  it('compares authoritative contribution without adding platform attribution', () => {
    const baseline = summarizeCampaignOutcomeWindow(window(1, 100));
    const followup = summarizeCampaignOutcomeWindow(window(8, 120));
    const result = assessCampaignOutcome(baseline, followup, 7);
    expect(result).toMatchObject({ direction: 'improved', baselineValue: 700, followupValue: 840 });
    expect(followup.onlineRevenueExTax).toBe(1_400);
    expect(result.explanation).toContain('does not establish campaign causality');
  });

  it('uses a one-percent tolerance for unchanged results', () => {
    const result = assessCampaignOutcome(
      summarizeCampaignOutcomeWindow(window(1, 100)),
      summarizeCampaignOutcomeWindow(window(8, 100.5)),
      7,
    );
    expect(result.direction).toBe('unchanged');
  });

  it('reports worsened contribution outside tolerance', () => {
    const result = assessCampaignOutcome(
      summarizeCampaignOutcomeWindow(window(1, 100)),
      summarizeCampaignOutcomeWindow(window(8, 80)),
      7,
    );
    expect(result.direction).toBe('worsened');
  });

  it('defers incomplete dates or blocked cost evidence', () => {
    const short = summarizeCampaignOutcomeWindow(window(1, 100).slice(0, 6));
    const blockedRows = window(8, 100);
    blockedRows[3] = row('2026-07-11', null);
    const blocked = summarizeCampaignOutcomeWindow(blockedRows);
    expect(assessCampaignOutcome(short, summarizeCampaignOutcomeWindow(window(8, 100)), 7).direction).toBe('unavailable');
    expect(assessCampaignOutcome(summarizeCampaignOutcomeWindow(window(1, 100)), blocked, 7).direction).toBe('unavailable');
  });
});