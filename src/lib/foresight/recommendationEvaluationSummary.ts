import type { PaidMediaContributorEvidence } from './types';
import type { WeeklyDigestSnapshot } from './weeklyDigest';

export interface RecommendationRuleCheck {
  key: 'revenue' | 'contribution_poas' | 'mer_deterioration';
  label: string;
  passed: boolean;
  detail: string;
}

export interface RecommendationEvaluationSummary {
  status: 'healthy' | 'attention' | 'insufficient_data';
  title: string;
  detail: string;
  checks: RecommendationRuleCheck[];
  contributors: PaidMediaContributorEvidence[];
}

export function buildRecommendationEvaluationSummary(
  digest: WeeklyDigestSnapshot | null,
  minimumContributionPoas = 1,
  merDeteriorationPercent = 25,
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

  return {
    status: healthy ? 'healthy' : 'attention',
    title: healthy ? 'No paid-media intervention is warranted' : 'One or more paid-media rules need attention',
    detail: healthy
      ? 'The complete evaluation window passed every active portfolio rule. Continue monitoring; no approval is required.'
      : 'Evaluate now to record any recommendation supported by the failed checks.',
    checks,
    contributors: digest.contributors,
  };
}