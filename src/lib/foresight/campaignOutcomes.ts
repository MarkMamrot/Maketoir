import type { DailyCommerceReconciliation } from './metrics/commerceReconciliation';
import type { DataQualityIssue } from './types';

export type CampaignOutcomeDirection = 'improved' | 'unchanged' | 'worsened' | 'unavailable';

export interface CampaignOutcomeWindow {
  windowStart: string | null;
  windowEnd: string | null;
  dayCount: number;
  onlineRevenueExTax: number;
  contributionBeforeAds: number | null;
  paidMediaSpend: number;
  mer: number | null;
  contributionPoas: number | null;
  qualityIssues: DataQualityIssue[];
}

export interface CampaignOutcomeAssessment {
  direction: CampaignOutcomeDirection;
  primaryMetric: 'contribution_before_ads' | null;
  baselineValue: number | null;
  followupValue: number | null;
  baseline: CampaignOutcomeWindow;
  followup: CampaignOutcomeWindow;
  explanation: string;
}

function uniqueIssues(rows: DailyCommerceReconciliation[]): DataQualityIssue[] {
  return [...new Map(
    rows.flatMap((row) => row.qualityIssues)
      .map((issue) => [`${issue.code}:${issue.severity}`, issue]),
  ).values()];
}

export function summarizeCampaignOutcomeWindow(
  rows: DailyCommerceReconciliation[],
): CampaignOutcomeWindow {
  const ordered = [...rows].sort((left, right) => left.metricDate.localeCompare(right.metricDate));
  const paidMediaSpend = ordered.reduce((sum, row) => sum + row.paidMedia.paidMediaSpend, 0);
  const onlineRevenueExTax = ordered.reduce((sum, row) => sum + row.onlineNetRevenueExTax, 0);
  const contributions = ordered.map((row) => row.onlineContribution.contributionProfitBeforeAds.value);
  const contributionBeforeAds = contributions.every((value) => value != null)
    ? contributions.reduce((sum, value) => sum + Number(value), 0)
    : null;

  return {
    windowStart: ordered[0]?.metricDate ?? null,
    windowEnd: ordered.at(-1)?.metricDate ?? null,
    dayCount: new Set(ordered.map((row) => row.metricDate)).size,
    onlineRevenueExTax,
    contributionBeforeAds,
    paidMediaSpend,
    mer: paidMediaSpend > 0 ? onlineRevenueExTax / paidMediaSpend : null,
    contributionPoas: paidMediaSpend > 0 && contributionBeforeAds != null
      ? contributionBeforeAds / paidMediaSpend
      : null,
    qualityIssues: uniqueIssues(ordered),
  };
}

function hasBlockingEvidence(window: CampaignOutcomeWindow): boolean {
  return window.qualityIssues.some(
    (issue) => issue.severity === 'blocking' || issue.code === 'missing_online_sales_observation',
  );
}

export function assessCampaignOutcome(
  baseline: CampaignOutcomeWindow,
  followup: CampaignOutcomeWindow,
  expectedDays: number,
): CampaignOutcomeAssessment {
  const unavailable = baseline.dayCount !== expectedDays
    || followup.dayCount !== expectedDays
    || baseline.contributionBeforeAds == null
    || followup.contributionBeforeAds == null
    || hasBlockingEvidence(baseline)
    || hasBlockingEvidence(followup);
  if (unavailable) {
    return {
      direction: 'unavailable',
      primaryMetric: null,
      baselineValue: null,
      followupValue: null,
      baseline,
      followup,
      explanation: 'The baseline or follow-up window has incomplete authoritative commerce or cost data, so no campaign outcome was inferred.',
    };
  }

  const tolerance = Math.max(Math.abs(baseline.contributionBeforeAds) * 0.01, 0.01);
  const direction = followup.contributionBeforeAds > baseline.contributionBeforeAds + tolerance
    ? 'improved'
    : followup.contributionBeforeAds < baseline.contributionBeforeAds - tolerance
      ? 'worsened'
      : 'unchanged';
  return {
    direction,
    primaryMetric: 'contribution_before_ads',
    baselineValue: baseline.contributionBeforeAds,
    followupValue: followup.contributionBeforeAds,
    baseline,
    followup,
    explanation: `Authoritative online contribution before advertising was ${direction} in the follow-up window compared with the baseline window. This is an observational comparison and does not establish campaign causality.`,
  };
}