import type { DailyCommerceReconciliation } from '../metrics/commerceReconciliation';
import type {
  DataQualityIssue,
  DataQualityResult,
  PaidMediaContributorEvidence,
  RecommendationEvidence,
} from '../types';

export const PAID_MEDIA_POLICY_VERSION = 2;
export const PAID_MEDIA_RULE_FORMULA_VERSION = 'foresight-paid-media-rules-v2';

export interface PaidMediaRulePolicy {
  strategyVersion: number;
  minimumCurrentDays: number;
  minimumSpend: number;
  zeroRevenueSpend: number;
  merDeteriorationPercent: number;
  minimumContributionPoas: number;
  maximumBudgetReductionPercent: number;
  targetMer: number;
  growthMinimumContributionPoas: number;
  maximumBudgetIncreasePercent: number;
  metaMinimumSpend?: number;
  metaMaximumRoas?: number;
}

export const DEFAULT_PAID_MEDIA_RULE_POLICY: PaidMediaRulePolicy = {
  strategyVersion: 0,
  minimumCurrentDays: 7,
  minimumSpend: 100,
  zeroRevenueSpend: 100,
  merDeteriorationPercent: 25,
  minimumContributionPoas: 1,
  maximumBudgetReductionPercent: 10,
  targetMer: 3,
  growthMinimumContributionPoas: 3,
  maximumBudgetIncreasePercent: 10,
  metaMinimumSpend: 25,
  metaMaximumRoas: 1,
};

export interface PaidMediaRuleRecommendation {
  fingerprint: string;
  channel: 'paid_media';
  subjectType: 'portfolio' | 'channel';
  subjectId: 'google_meta_blended' | 'meta_ads';
  ruleId: 'spend_without_online_revenue' | 'contribution_poas_below_one' | 'mer_deterioration' | 'profitable_growth_opportunity' | 'meta_channel_underperformance';
  evidence: RecommendationEvidence;
  proposedAction: Record<string, unknown>;
  confidence: number;
  expectedImpactLow: number | null;
  expectedImpactHigh: number | null;
}

interface WindowTotals {
  start: string;
  end: string;
  days: number;
  spend: number;
  revenue: number;
  contributionBeforeAds: number;
  mer: number | null;
  contributionPoas: number | null;
  issues: DataQualityIssue[];
}

function quality(issues: DataQualityIssue[]): DataQualityResult {
  return {
    grade: issues.some((issue) => issue.severity === 'blocking')
      ? 'blocked'
      : issues.length > 0 ? 'partial' : 'good',
    issues,
  };
}

function uniqueIssues(rows: DailyCommerceReconciliation[]): DataQualityIssue[] {
  const issues = rows.flatMap((row) => row.qualityIssues);
  return [...new Map(issues.map((issue) => [`${issue.code}:${issue.severity}`, issue])).values()];
}

function totals(rows: DailyCommerceReconciliation[]): WindowTotals | null {
  if (rows.length === 0) return null;
  const spend = rows.reduce((sum, row) => sum + row.paidMedia.paidMediaSpend, 0);
  const revenue = rows.reduce((sum, row) => sum + row.onlineNetRevenueExTax, 0);
  const contributionValues = rows.map((row) => row.onlineContribution.contributionProfitBeforeAds.value);
  const contributionBeforeAds = contributionValues.every((value) => value != null)
    ? contributionValues.reduce((sum, value) => sum + Number(value), 0)
    : Number.NaN;
  return {
    start: rows[0].metricDate,
    end: rows[rows.length - 1].metricDate,
    days: rows.length,
    spend,
    revenue,
    contributionBeforeAds,
    mer: spend > 0 ? revenue / spend : null,
    contributionPoas: spend > 0 && Number.isFinite(contributionBeforeAds)
      ? contributionBeforeAds / spend
      : null,
    issues: uniqueIssues(rows),
  };
}

function evidence(
  current: WindowTotals,
  metricKeys: string[],
  observedValues: Record<string, number | null>,
  contributors: PaidMediaContributorEvidence[],
): RecommendationEvidence {
  return {
    metricKeys,
    sourceIds: [`commerce:${current.start}:${current.end}`, `paid-media:${current.start}:${current.end}`],
    windowStart: current.start,
    windowEnd: current.end,
    quality: quality(current.issues),
    observedValues,
    ...(contributors.length > 0 ? { contributors } : {}),
  };
}

function fingerprint(ruleId: string, current: WindowTotals, policy: PaidMediaRulePolicy): string {
  const subjectId = ruleId === 'meta_channel_underperformance' ? 'meta_ads' : 'google_meta_blended';
  return `${ruleId}:${subjectId}:${current.start}:${current.end}:p${PAID_MEDIA_POLICY_VERSION}:s${policy.strategyVersion}`;
}

export function evaluatePaidMediaPortfolioRules(
  rows: DailyCommerceReconciliation[],
  policy: PaidMediaRulePolicy = DEFAULT_PAID_MEDIA_RULE_POLICY,
  contributors: PaidMediaContributorEvidence[] = [],
): PaidMediaRuleRecommendation[] {
  const ordered = [...rows].sort((left, right) => left.metricDate.localeCompare(right.metricDate));
  if (ordered.length < policy.minimumCurrentDays) return [];

  const currentRows = ordered.slice(-policy.minimumCurrentDays);
  const previousRows = ordered.slice(-policy.minimumCurrentDays * 2, -policy.minimumCurrentDays);
  const current = totals(currentRows);
  const previous = totals(previousRows);
  if (!current || current.issues.some((issue) => issue.severity === 'blocking')) return [];

  const recommendations: PaidMediaRuleRecommendation[] = [];
  const metaCampaigns = contributors.filter((item) =>
    item.source === 'meta_ads'
    && item.entityType === 'campaign'
    && item.currentSpend > 0);
  const metaSpend = metaCampaigns.reduce((sum, item) => sum + item.currentSpend, 0);
  const metaAttributedRevenue = metaCampaigns.reduce(
    (sum, item) => sum + item.currentAttributedRevenue,
    0,
  );
  const metaRoas = metaSpend > 0 ? metaAttributedRevenue / metaSpend : null;
  const metaMinimumSpend = policy.metaMinimumSpend ?? 25;
  const metaMaximumRoas = policy.metaMaximumRoas ?? 1;
  if (metaSpend >= metaMinimumSpend && metaRoas != null && metaRoas < metaMaximumRoas) {
    const weakCampaignIds = new Set(metaCampaigns
      .filter((item) => item.currentPlatformRoas == null || item.currentPlatformRoas < metaMaximumRoas)
      .map((item) => item.entityId));
    const metaEvidence = contributors.filter((item) =>
      item.source === 'meta_ads'
      && (weakCampaignIds.has(item.entityId)
        || (item.parentEntityId != null && weakCampaignIds.has(item.parentEntityId))));
    recommendations.push({
      fingerprint: fingerprint('meta_channel_underperformance', current, policy),
      channel: 'paid_media',
      subjectType: 'channel',
      subjectId: 'meta_ads',
      ruleId: 'meta_channel_underperformance',
      evidence: evidence(current, ['meta_ads_spend', 'meta_ads_platform_roas'], {
        metaSpend,
        metaAttributedRevenue,
        metaRoas,
        metaMinimumSpend,
        metaMaximumRoas,
      }, metaEvidence),
      proposedAction: {
        type: 'review_meta_channel_performance',
        reason: 'Meta campaign-level attributed revenue remained below the configured diagnostic ROAS boundary.',
      },
      confidence: 0.75,
      expectedImpactLow: null,
      expectedImpactHigh: null,
    });
  }

  if (current.spend >= policy.zeroRevenueSpend && current.revenue <= 0) {
    recommendations.push({
      fingerprint: fingerprint('spend_without_online_revenue', current, policy),
      channel: 'paid_media',
      subjectType: 'portfolio',
      subjectId: 'google_meta_blended',
      ruleId: 'spend_without_online_revenue',
      evidence: evidence(current, ['paid_media_spend', 'net_online_revenue_ex_tax'], {
        spend: current.spend,
        onlineRevenueExTax: current.revenue,
      }, contributors),
      proposedAction: {
        type: 'investigate_measurement_and_spend',
        reason: 'Paid media recorded spend without authoritative online revenue in the evaluation window.',
      },
      confidence: 0.9,
      expectedImpactLow: null,
      expectedImpactHigh: current.spend,
    });
  }

  if (
    current.spend >= policy.minimumSpend
    && current.contributionPoas != null
    && current.contributionPoas < policy.minimumContributionPoas
  ) {
    const lossAfterAds = current.spend - current.contributionBeforeAds;
    recommendations.push({
      fingerprint: fingerprint('contribution_poas_below_one', current, policy),
      channel: 'paid_media',
      subjectType: 'portfolio',
      subjectId: 'google_meta_blended',
      ruleId: 'contribution_poas_below_one',
      evidence: evidence(current, ['contribution_poas', 'paid_media_spend'], {
        contributionPoas: current.contributionPoas,
        minimumContributionPoas: policy.minimumContributionPoas,
        spend: current.spend,
        contributionBeforeAds: current.contributionBeforeAds,
      }, contributors),
      proposedAction: {
        type: 'review_budget_reduction',
        maximumReductionPercent: policy.maximumBudgetReductionPercent,
        reason: `Contribution POAS fell below the configured ${policy.minimumContributionPoas} floor.`,
      },
      confidence: 0.85,
      expectedImpactLow: 0,
      expectedImpactHigh: Math.max(0, lossAfterAds),
    });
  }

  if (
    previous
    && previous.days === policy.minimumCurrentDays
    && previous.spend >= policy.minimumSpend
    && previous.mer != null
    && previous.mer > 0
    && current.spend >= policy.minimumSpend
    && current.mer != null
  ) {
    const deteriorationPercent = ((previous.mer - current.mer) / previous.mer) * 100;
    if (deteriorationPercent >= policy.merDeteriorationPercent) {
      recommendations.push({
        fingerprint: fingerprint('mer_deterioration', current, policy),
        channel: 'paid_media',
        subjectType: 'portfolio',
        subjectId: 'google_meta_blended',
        ruleId: 'mer_deterioration',
        evidence: evidence(current, ['paid_media_ecommerce_mer'], {
          currentMer: current.mer,
          previousMer: previous.mer,
          deteriorationPercent,
          merDeteriorationPercent: policy.merDeteriorationPercent,
          spend: current.spend,
        }, contributors),
        proposedAction: {
          type: 'review_channel_and_campaign_mix',
          reason: 'Blended online MER deteriorated against the immediately preceding equal window.',
        },
        confidence: 0.8,
        expectedImpactLow: null,
        expectedImpactHigh: null,
      });
    }
  }

  const stableCampaigns = contributors.filter((item) =>
    item.entityType === 'campaign'
    && item.currentSpend > 0
    && item.currentAttributedRevenue > 0
    && (item.source !== 'meta_ads'
      || (item.currentPlatformRoas != null && item.currentPlatformRoas >= metaMaximumRoas))
    && (item.platformRoasChangePercent == null
      || item.platformRoasChangePercent > -policy.merDeteriorationPercent)
    && !item.signals.includes('spend_without_platform_revenue'));
  if (
    previous
    && previous.days === policy.minimumCurrentDays
    && !previous.issues.some((issue) => issue.severity === 'blocking')
    && current.spend >= policy.minimumSpend
    && previous.spend >= policy.minimumSpend
    && current.revenue > 0
    && previous.revenue > 0
    && current.mer != null
    && previous.mer != null
    && current.mer >= policy.targetMer
    && previous.mer >= policy.targetMer
    && ((previous.mer - current.mer) / previous.mer) * 100 < policy.merDeteriorationPercent
    && current.contributionPoas != null
    && previous.contributionPoas != null
    && current.contributionPoas >= policy.growthMinimumContributionPoas
    && previous.contributionPoas >= policy.growthMinimumContributionPoas
    && policy.maximumBudgetIncreasePercent > 0
    && stableCampaigns.length > 0
  ) {
    recommendations.push({
      fingerprint: fingerprint('profitable_growth_opportunity', current, policy),
      channel: 'paid_media',
      subjectType: 'portfolio',
      subjectId: 'google_meta_blended',
      ruleId: 'profitable_growth_opportunity',
      evidence: evidence(current, ['contribution_poas', 'paid_media_ecommerce_mer'], {
        currentContributionPoas: current.contributionPoas,
        previousContributionPoas: previous.contributionPoas,
        growthMinimumContributionPoas: policy.growthMinimumContributionPoas,
        currentMer: current.mer,
        previousMer: previous.mer,
        targetMer: policy.targetMer,
        merDeteriorationPercent: policy.merDeteriorationPercent,
        spend: current.spend,
      }, stableCampaigns),
      proposedAction: {
        type: 'review_capped_budget_increase',
        maximumIncreasePercent: policy.maximumBudgetIncreasePercent,
        reason: 'Both complete evaluation windows remained above the configured MER and contribution POAS growth guardrails.',
      },
      confidence: 0.75,
      expectedImpactLow: null,
      expectedImpactHigh: null,
    });
  }

  return recommendations;
}