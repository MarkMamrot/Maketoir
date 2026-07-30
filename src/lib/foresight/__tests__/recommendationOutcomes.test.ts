import { describe, expect, it } from 'vitest';
import type { DailyCommerceReconciliation } from '../metrics/commerceReconciliation';
import {
  assessPaidMediaRecommendationOutcome,
  summarizePaidMediaOutcomeWindow,
} from '../recommendationOutcomes';

function row(input: {
  date?: string;
  spend?: number;
  revenue?: number;
  contributionBeforeAds?: number | null;
  blocking?: boolean;
} = {}): DailyCommerceReconciliation {
  const spend = input.spend ?? 100;
  const revenue = input.revenue ?? 200;
  const contribution = input.contributionBeforeAds === undefined ? 120 : input.contributionBeforeAds;
  return {
    metricDate: input.date ?? '2026-07-20',
    googleAdsSpend: spend,
    metaAdsSpend: 0,
    onlineNetRevenueExTax: revenue,
    posNetRevenueExTax: 0,
    totalRetailNetRevenueExTax: revenue,
    paidMedia: {
      googleAdsSpend: spend,
      metaAdsSpend: 0,
      paidMediaSpend: spend,
      backendNetOnlineRevenue: revenue,
      paidMediaEcommerceMer: { key: 'paid_media_ecommerce_mer', value: revenue / spend, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
    },
    onlineContribution: {
      netRevenueExTax: { key: 'net_revenue_ex_tax', value: revenue, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
      grossProfit: { key: 'gross_profit', value: contribution, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
      contributionProfitBeforeAds: { key: 'contribution_profit_before_ads', value: contribution, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
      contributionProfitAfterAds: { key: 'contribution_profit_after_ads', value: contribution == null ? null : contribution - spend, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
      contributionPoas: { key: 'contribution_poas', value: contribution == null ? null : contribution / spend, formulaVersion: 'test', quality: { grade: 'good', issues: [] } },
    },
    qualityIssues: input.blocking ? [{ code: 'incomplete_online_cogs', severity: 'blocking', message: 'Missing cost.' }] : [],
  };
}

describe('recommendation outcome assessment', () => {
  it('marks spend without revenue resolved when authoritative revenue appears', () => {
    const followup = summarizePaidMediaOutcomeWindow([row({ revenue: 250 })]);
    const outcome = assessPaidMediaRecommendationOutcome(
      'spend_without_online_revenue',
      { spend: 100, onlineRevenueExTax: 0 },
      followup,
    );
    expect(outcome).toMatchObject({ direction: 'improved', conditionState: 'resolved', followupValue: 250 });
  });

  it('distinguishes an improving metric from a still-persisting contribution condition', () => {
    const followup = summarizePaidMediaOutcomeWindow([row({ contributionBeforeAds: 90 })]);
    const outcome = assessPaidMediaRecommendationOutcome(
      'contribution_poas_below_one',
      { contributionPoas: 0.6, minimumContributionPoas: 1 },
      followup,
    );
    expect(outcome).toMatchObject({ direction: 'improved', conditionState: 'persisted', followupValue: 0.9 });
  });

  it('marks MER as worsened when it falls further below the original boundary', () => {
    const followup = summarizePaidMediaOutcomeWindow([row({ revenue: 120 })]);
    const outcome = assessPaidMediaRecommendationOutcome(
      'mer_deterioration',
      { currentMer: 1.5, previousMer: 3, merDeteriorationPercent: 25 },
      followup,
    );
    expect(outcome).toMatchObject({ direction: 'worsened', conditionState: 'persisted', followupValue: 1.2 });
  });

  it('measures whether profitable-growth guardrails remain sustained', () => {
    const followup = summarizePaidMediaOutcomeWindow([
      row({ spend: 100, revenue: 500, contributionBeforeAds: 350 }),
    ]);
    const outcome = assessPaidMediaRecommendationOutcome(
      'profitable_growth_opportunity',
      { currentContributionPoas: 3.2, growthMinimumContributionPoas: 3, targetMer: 3 },
      followup,
    );

    expect(outcome).toMatchObject({
      direction: 'improved',
      conditionState: 'persisted',
      primaryMetric: 'contribution_poas',
      followupValue: 3.5,
    });
  });

  it('does not infer an outcome from blocking follow-up quality', () => {
    const followup = summarizePaidMediaOutcomeWindow([row({ contributionBeforeAds: null, blocking: true })]);
    const outcome = assessPaidMediaRecommendationOutcome(
      'contribution_poas_below_one',
      { contributionPoas: 0.6, minimumContributionPoas: 1 },
      followup,
    );
    expect(outcome).toMatchObject({ direction: 'unavailable', conditionState: 'unknown' });
  });

  it('does not treat missing authoritative commerce as zero revenue', () => {
    const followup = summarizePaidMediaOutcomeWindow([row({ revenue: 0 })]);
    followup.qualityIssues = [{
      code: 'missing_online_sales_observation',
      severity: 'warning',
      message: 'No authoritative online sales observation is available.',
    }];

    const outcome = assessPaidMediaRecommendationOutcome(
      'spend_without_online_revenue',
      { spend: 100, onlineRevenueExTax: 0 },
      followup,
    );

    expect(outcome).toMatchObject({ direction: 'unavailable', conditionState: 'unknown' });
  });
});