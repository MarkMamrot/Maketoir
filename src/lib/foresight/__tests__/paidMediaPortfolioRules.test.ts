import { describe, expect, it } from 'vitest';
import type { DailyCommerceReconciliation } from '../metrics/commerceReconciliation';
import { evaluatePaidMediaPortfolioRules } from '../rules/paidMediaPortfolioRules';

function day(
  metricDate: string,
  spend: number,
  revenue: number,
  contributionBeforeAds: number,
  blocked = false,
): DailyCommerceReconciliation {
  const qualityIssues = blocked
    ? [{ code: 'incomplete_online_cogs', severity: 'blocking' as const, message: 'Missing cost.' }]
    : [];
  const metric = (key: string, value: number | null) => ({
    key,
    value,
    formulaVersion: 'test',
    quality: { grade: blocked ? 'blocked' as const : 'good' as const, issues: qualityIssues },
  });
  return {
    metricDate,
    googleAdsSpend: spend,
    metaAdsSpend: 0,
    onlineNetRevenueExTax: revenue,
    posNetRevenueExTax: 0,
    totalRetailNetRevenueExTax: revenue,
    paidMedia: {
      paidMediaSpend: spend,
      paidMediaMer: metric('paid_media_ecommerce_mer', spend > 0 ? revenue / spend : null),
      klaviyoAttributedRevenue: metric('klaviyo_attributed_revenue', 0),
    },
    onlineContribution: {
      netRevenueExTax: metric('net_revenue_ex_tax', revenue),
      grossProfit: metric('gross_profit', contributionBeforeAds),
      grossMarginPct: metric('gross_margin_pct', null),
      contributionProfitBeforeAds: metric('contribution_profit_before_ads', blocked ? null : contributionBeforeAds),
      contributionMarginPct: metric('contribution_margin_pct', null),
      breakEvenRoas: metric('break_even_roas', null),
      contributionPoas: metric('contribution_poas', blocked || spend <= 0 ? null : contributionBeforeAds / spend),
    },
    qualityIssues,
  };
}

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`);
}

describe('paid media portfolio rules', () => {
  it('requires a complete minimum current window', () => {
    expect(evaluatePaidMediaPortfolioRules(dates(6).map((date) => day(date, 20, 100, 60)))).toEqual([]);
  });

  it('flags meaningful spend with no authoritative online revenue', () => {
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(7).map((date) => day(date, 20, 0, 0)),
    );

    expect(recommendations.map((item) => item.ruleId)).toContain('spend_without_online_revenue');
    expect(recommendations[0].channel).toBe('paid_media');
    expect(recommendations[0].evidence.observedValues?.spend).toBe(140);
  });

  it('flags spend above online contribution but does not prescribe an executable platform change', () => {
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(7).map((date) => day(date, 20, 40, 10)),
    );
    const recommendation = recommendations.find((item) => item.ruleId === 'contribution_poas_below_one');

    expect(recommendation?.evidence.observedValues?.contributionPoas).toBe(0.5);
    expect(recommendation?.proposedAction.type).toBe('review_budget_reduction');
    expect(recommendation?.proposedAction.maximumReductionPercent).toBe(10);
  });

  it('uses configured contribution and reduction guardrails in the proposal identity', () => {
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(7).map((date) => day(date, 20, 40, 25)),
      {
        strategyVersion: 3,
        minimumCurrentDays: 7,
        minimumSpend: 100,
        zeroRevenueSpend: 100,
        merDeteriorationPercent: 25,
        minimumContributionPoas: 1.5,
        maximumBudgetReductionPercent: 6,
      },
    );
    const recommendation = recommendations.find((item) => item.ruleId === 'contribution_poas_below_one');

    expect(recommendation?.fingerprint).toContain(':s3');
    expect(recommendation?.proposedAction.maximumReductionPercent).toBe(6);
  });

  it('compares current MER with the immediately preceding equal window', () => {
    const rows = dates(14).map((date, index) =>
      index < 7 ? day(date, 20, 100, 60) : day(date, 20, 50, 30));
    const recommendations = evaluatePaidMediaPortfolioRules(rows);
    const recommendation = recommendations.find((item) => item.ruleId === 'mer_deterioration');

    expect(recommendation?.evidence.observedValues?.previousMer).toBe(5);
    expect(recommendation?.evidence.observedValues?.currentMer).toBe(2.5);
    expect(recommendation?.evidence.observedValues?.deteriorationPercent).toBe(50);
  });

  it('emits no recommendations when current COGS quality is blocked', () => {
    expect(evaluatePaidMediaPortfolioRules(
      dates(7).map((date) => day(date, 20, 100, 40, true)),
    )).toEqual([]);
  });

  it('attaches ranked entity evidence without changing portfolio calculations', () => {
    const contributor = {
      source: 'meta_ads' as const,
      entityType: 'campaign' as const,
      entityId: 'campaign-1',
      entityName: 'Prospecting',
      parentEntityId: null,
      parentEntityName: null,
      currentSpend: 140,
      previousSpend: 100,
      spendChange: 40,
      currentAttributedRevenue: 100,
      previousAttributedRevenue: 300,
      currentPlatformRoas: 0.71,
      previousPlatformRoas: 3,
      platformRoasChangePercent: -76.33,
      diagnosticScore: 146.87,
      signals: ['spend_increase', 'platform_roas_decline'] as const,
    };
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(7).map((date) => day(date, 20, 0, 0)),
      undefined,
      [contributor],
    );

    expect(recommendations[0].evidence.contributors).toEqual([contributor]);
    expect(recommendations[0].evidence.observedValues?.spend).toBe(140);
  });

  it('suggests a capped growth review after two strong windows with a stable campaign', () => {
    const contributor = {
      source: 'google_ads' as const,
      entityType: 'campaign' as const,
      entityId: 'campaign-1',
      entityName: 'Stable PMax',
      parentEntityId: null,
      parentEntityName: null,
      currentSpend: 140,
      previousSpend: 140,
      spendChange: 0,
      currentAttributedRevenue: 700,
      previousAttributedRevenue: 650,
      currentPlatformRoas: 5,
      previousPlatformRoas: 4.64,
      platformRoasChangePercent: 7.8,
      diagnosticScore: 0,
      signals: [] as const,
    };
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(14).map((date) => day(date, 20, 100, 70)),
      undefined,
      [contributor],
    );
    const recommendation = recommendations.find((item) => item.ruleId === 'profitable_growth_opportunity');

    expect(recommendation?.proposedAction).toMatchObject({
      type: 'review_capped_budget_increase',
      maximumIncreasePercent: 10,
    });
    expect(recommendation?.evidence.contributors).toEqual([contributor]);
  });

  it('does not suggest growth when campaign ROAS declines beyond the configured tolerance', () => {
    const contributor = {
      source: 'google_ads' as const,
      entityType: 'campaign' as const,
      entityId: 'campaign-1',
      entityName: 'Declining PMax',
      parentEntityId: null,
      parentEntityName: null,
      currentSpend: 140,
      previousSpend: 100,
      spendChange: 40,
      currentAttributedRevenue: 350,
      previousAttributedRevenue: 500,
      currentPlatformRoas: 2.5,
      previousPlatformRoas: 5,
      platformRoasChangePercent: -50,
      diagnosticScore: 70,
      signals: ['spend_increase', 'platform_roas_decline'] as const,
    };
    const recommendations = evaluatePaidMediaPortfolioRules(
      dates(14).map((date) => day(date, 20, 100, 70)),
      undefined,
      [contributor],
    );

    expect(recommendations.some((item) => item.ruleId === 'profitable_growth_opportunity')).toBe(false);
  });
});