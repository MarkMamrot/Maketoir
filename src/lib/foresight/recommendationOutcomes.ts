import type { DailyCommerceReconciliation } from './metrics/commerceReconciliation';
import type { DataQualityIssue } from './types';

export type RecommendationOutcomeDirection = 'improved' | 'unchanged' | 'worsened' | 'unavailable';
export type RecommendationConditionState = 'resolved' | 'persisted' | 'unknown';

export interface PaidMediaOutcomeWindow {
  windowStart: string | null;
  windowEnd: string | null;
  spend: number;
  onlineRevenueExTax: number;
  contributionPoas: number | null;
  mer: number | null;
  qualityIssues: DataQualityIssue[];
}

export interface RecommendationOutcomeAssessment {
  direction: RecommendationOutcomeDirection;
  conditionState: RecommendationConditionState;
  primaryMetric: string | null;
  baselineValue: number | null;
  followupValue: number | null;
  followup: PaidMediaOutcomeWindow;
  explanation: string;
}

function uniqueIssues(rows: DailyCommerceReconciliation[]): DataQualityIssue[] {
  return [...new Map(
    rows.flatMap((row) => row.qualityIssues)
      .map((issue) => [`${issue.code}:${issue.severity}`, issue]),
  ).values()];
}

export function summarizePaidMediaOutcomeWindow(
  rows: DailyCommerceReconciliation[],
): PaidMediaOutcomeWindow {
  const ordered = [...rows].sort((left, right) => left.metricDate.localeCompare(right.metricDate));
  const spend = ordered.reduce((sum, row) => sum + row.paidMedia.paidMediaSpend, 0);
  const onlineRevenueExTax = ordered.reduce((sum, row) => sum + row.onlineNetRevenueExTax, 0);
  const contributions = ordered.map((row) => row.onlineContribution.contributionProfitBeforeAds.value);
  const contributionBeforeAds = contributions.every((value) => value != null)
    ? contributions.reduce((sum, value) => sum + Number(value), 0)
    : null;

  return {
    windowStart: ordered[0]?.metricDate ?? null,
    windowEnd: ordered.at(-1)?.metricDate ?? null,
    spend,
    onlineRevenueExTax,
    contributionPoas: spend > 0 && contributionBeforeAds != null ? contributionBeforeAds / spend : null,
    mer: spend > 0 ? onlineRevenueExTax / spend : null,
    qualityIssues: uniqueIssues(ordered),
  };
}

function direction(current: number, baseline: number): Exclude<RecommendationOutcomeDirection, 'unavailable'> {
  const tolerance = Math.max(Math.abs(baseline) * 0.01, 0.01);
  if (current > baseline + tolerance) return 'improved';
  if (current < baseline - tolerance) return 'worsened';
  return 'unchanged';
}

function unavailable(followup: PaidMediaOutcomeWindow, explanation: string): RecommendationOutcomeAssessment {
  return {
    direction: 'unavailable',
    conditionState: 'unknown',
    primaryMetric: null,
    baselineValue: null,
    followupValue: null,
    followup,
    explanation,
  };
}

export function assessPaidMediaRecommendationOutcome(
  ruleId: string,
  baseline: Record<string, number | null>,
  followup: PaidMediaOutcomeWindow,
): RecommendationOutcomeAssessment {
  const authoritativeDataMissing = followup.qualityIssues.some(
    (issue) => issue.severity === 'blocking' || issue.code === 'missing_online_sales_observation',
  );
  if (!followup.windowStart || authoritativeDataMissing) {
    return unavailable(followup, 'The follow-up window has incomplete authoritative data, so no outcome was inferred.');
  }

  if (ruleId === 'spend_without_online_revenue') {
    const baselineRevenue = baseline.onlineRevenueExTax ?? 0;
    const resolved = followup.onlineRevenueExTax > 0 || followup.spend <= 0;
    return {
      direction: resolved ? 'improved' : 'unchanged',
      conditionState: resolved ? 'resolved' : 'persisted',
      primaryMetric: 'net_online_revenue_ex_tax',
      baselineValue: baselineRevenue,
      followupValue: followup.onlineRevenueExTax,
      followup,
      explanation: resolved
        ? 'The spend-without-authoritative-revenue condition was not present in the follow-up window.'
        : 'Paid-media spend continued without authoritative online revenue in the follow-up window.',
    };
  }

  if (ruleId === 'contribution_poas_below_one') {
    const baselineValue = baseline.contributionPoas;
    const threshold = baseline.minimumContributionPoas ?? 1;
    if (baselineValue == null || followup.contributionPoas == null) {
      return unavailable(followup, 'Contribution POAS could not be calculated for both windows.');
    }
    const resolved = followup.contributionPoas >= threshold;
    return {
      direction: direction(followup.contributionPoas, baselineValue),
      conditionState: resolved ? 'resolved' : 'persisted',
      primaryMetric: 'contribution_poas',
      baselineValue,
      followupValue: followup.contributionPoas,
      followup,
      explanation: resolved
        ? `Contribution POAS recovered above the ${threshold.toFixed(2)} configured floor.`
        : `Contribution POAS remained below the ${threshold.toFixed(2)} configured floor.`,
    };
  }

  if (ruleId === 'mer_deterioration') {
    const baselineValue = baseline.currentMer;
    const previousMer = baseline.previousMer;
    const deteriorationThreshold = baseline.merDeteriorationPercent ?? 25;
    if (baselineValue == null || previousMer == null || followup.mer == null) {
      return unavailable(followup, 'MER could not be calculated for the baseline and follow-up windows.');
    }
    const recoveryFloor = previousMer * (1 - deteriorationThreshold / 100);
    const resolved = followup.mer >= recoveryFloor;
    return {
      direction: direction(followup.mer, baselineValue),
      conditionState: resolved ? 'resolved' : 'persisted',
      primaryMetric: 'paid_media_ecommerce_mer',
      baselineValue,
      followupValue: followup.mer,
      followup,
      explanation: resolved
        ? 'Blended MER recovered beyond the configured deterioration boundary.'
        : 'Blended MER remained beyond the configured deterioration boundary.',
    };
  }

  if (ruleId === 'profitable_growth_opportunity') {
    const baselineValue = baseline.currentContributionPoas;
    const poasFloor = baseline.growthMinimumContributionPoas ?? 3;
    const targetMer = baseline.targetMer ?? 3;
    if (baselineValue == null || followup.contributionPoas == null || followup.mer == null) {
      return unavailable(followup, 'Contribution POAS and MER could not be calculated for the growth follow-up window.');
    }
    const sustained = followup.contributionPoas >= poasFloor && followup.mer >= targetMer;
    return {
      direction: direction(followup.contributionPoas, baselineValue),
      conditionState: sustained ? 'persisted' : 'resolved',
      primaryMetric: 'contribution_poas',
      baselineValue,
      followupValue: followup.contributionPoas,
      followup,
      explanation: sustained
        ? 'Contribution POAS and MER remained above the configured profitable-growth guardrails.'
        : 'The portfolio no longer met both profitable-growth guardrails in the follow-up window.',
    };
  }

  return unavailable(followup, 'This recommendation rule does not yet have a deterministic outcome measure.');
}