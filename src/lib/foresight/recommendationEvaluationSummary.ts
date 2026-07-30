import type { PaidMediaContributorEvidence } from './types';
import type { WeeklyDigestSnapshot } from './weeklyDigest';

export interface RecommendationRuleCheck {
  key: 'revenue' | 'contribution_poas' | 'mer_deterioration';
  label: string;
  passed: boolean;
  detail: string;
}

export interface RecommendationEvaluationSummary {
  status: 'healthy' | 'opportunity' | 'attention' | 'insufficient_data';
  title: string;
  detail: string;
  checks: RecommendationRuleCheck[];
  contributors: PaidMediaContributorEvidence[];
}

export function buildRecommendationEvaluationSummary(
  digest: WeeklyDigestSnapshot | null,
  minimumContributionPoas = 1,
  merDeteriorationPercent = 25,
  targetMer = 3,
  growthMinimumContributionPoas = 3,
  maximumBudgetIncreasePercent = 10,
): RecommendationEvaluationSummary {
  if (!digest || !digest.current.complete) {
    return {
      status: 'insufficient_data',
      title: 'Evaluation needs complete financial data',
      detail: 'Refresh source observations and Weekly Performance before evaluating recommendations.',
      checks: [],
      contributors: digest?.contributors ?? [],
    };
  }

  const hasRevenue = digest.current.onlineRevenueExTax > 0;
  const poas = digest.current.contributionPoas;
  const poasHealthy = poas != null && poas >= minimumContributionPoas;
  const merChange = digest.changes.merPercent;
  const merHealthy = merChange == null || merChange > -merDeteriorationPercent;
  const checks: RecommendationRuleCheck[] = [
    {
      key: 'revenue',
      label: 'Spend has authoritative online revenue',
      passed: hasRevenue,
      detail: hasRevenue
        ? `${digest.current.onlineRevenueExTax.toFixed(2)} revenue ex GST was observed.`
        : 'Paid-media spend was recorded without authoritative online revenue.',
    },
    {
      key: 'contribution_poas',
      label: 'Contribution POAS is above its floor',
      passed: poasHealthy,
      detail: poas == null
        ? 'Contribution POAS is unavailable.'
        : `${poas.toFixed(2)} compared with the ${minimumContributionPoas.toFixed(2)} floor.`,
    },
    {
      key: 'mer_deterioration',
      label: 'MER has not crossed the deterioration boundary',
      passed: merHealthy,
      detail: merChange == null
        ? 'MER is not comparable with the prior window.'
        : `${merChange >= 0 ? '+' : ''}${merChange.toFixed(1)}% versus a -${merDeteriorationPercent.toFixed(1)}% boundary.`,
    },
  ];
  const healthy = checks.every((check) => check.passed);
  const stableCampaign = digest.contributors.some((contributor) =>
    contributor.entityType === 'campaign'
    && contributor.currentSpend > 0
    && contributor.currentAttributedRevenue > 0
    && (contributor.platformRoasChangePercent == null
      || contributor.platformRoasChangePercent > -merDeteriorationPercent)
    && !contributor.signals.includes('spend_without_platform_revenue'));
  const growthEligible = digest.previous.complete
    && maximumBudgetIncreasePercent > 0
    && digest.current.mer != null
    && digest.previous.mer != null
    && digest.current.mer >= targetMer
    && digest.previous.mer >= targetMer
    && digest.current.contributionPoas != null
    && digest.previous.contributionPoas != null
    && digest.current.contributionPoas >= growthMinimumContributionPoas
    && digest.previous.contributionPoas >= growthMinimumContributionPoas
    && stableCampaign;

  return {
    status: growthEligible ? 'opportunity' : healthy ? 'healthy' : 'attention',
    title: growthEligible
      ? 'A profitable-growth opportunity is ready for evaluation'
      : healthy ? 'No paid-media intervention is warranted' : 'One or more paid-media rules need attention',
    detail: growthEligible
      ? `Both complete windows passed the ${growthMinimumContributionPoas.toFixed(2)} contribution POAS and ${targetMer.toFixed(2)} MER growth guardrails. Evaluate now to record a manual increase review capped at ${maximumBudgetIncreasePercent}%.`
      : healthy
        ? 'The complete evaluation window passed every active portfolio rule. Continue monitoring; no approval is required.'
        : 'Evaluate now to record any recommendation supported by the failed checks.',
    checks,
    contributors: digest.contributors,
  };
}