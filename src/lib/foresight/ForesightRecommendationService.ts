import { ForesightMetricsService } from './ForesightMetricsService';
import { diagnosePaidMediaContributors } from './metrics/campaignDiagnosis';
import {
  DEFAULT_FORESIGHT_MARKETING_STRATEGY,
  parseMarketingStrategy,
} from './marketingStrategy';
import { ForesightRepository } from './repositories/ForesightRepository';
import {
  evaluatePaidMediaPortfolioRules,
  PAID_MEDIA_POLICY_VERSION,
  PAID_MEDIA_RULE_FORMULA_VERSION,
} from './rules/paidMediaPortfolioRules';

const PAID_MEDIA_RULE_IDS = [
  'spend_without_online_revenue',
  'contribution_poas_below_one',
  'mer_deterioration',
  'profitable_growth_opportunity',
  'meta_channel_underperformance',
];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const ForesightRecommendationService = {
  async evaluatePaidMedia(businessId: string, throughDate: string) {
    const storedStrategy = await ForesightRepository.latestStrategy(businessId);
    const strategy = storedStrategy
      ? parseMarketingStrategy(storedStrategy.strategy_json)
      : DEFAULT_FORESIGHT_MARKETING_STRATEGY;
    const policy = {
      strategyVersion: storedStrategy?.version ?? 0,
      minimumCurrentDays: strategy.paidMedia.evaluationWindowDays,
      minimumSpend: strategy.paidMedia.minimumSpend,
      zeroRevenueSpend: strategy.paidMedia.zeroRevenueSpend,
      merDeteriorationPercent: strategy.paidMedia.merDeteriorationPercent,
      minimumContributionPoas: strategy.paidMedia.minimumContributionPoas,
      maximumBudgetReductionPercent: strategy.paidMedia.maximumBudgetReductionPercent,
      targetMer: strategy.paidMedia.targetMer,
      growthMinimumContributionPoas: strategy.paidMedia.growthMinimumContributionPoas,
      maximumBudgetIncreasePercent: strategy.paidMedia.maximumBudgetIncreasePercent,
      metaMinimumSpend: strategy.paidMedia.metaMinimumSpend,
      metaMaximumRoas: strategy.paidMedia.metaMaximumRoas,
    };
    const startDate = addDays(throughDate, -(policy.minimumCurrentDays * 2 - 1));
    const metrics = await ForesightMetricsService.getDailyMarketingMetrics(
      businessId,
      startDate,
      throughDate,
    );
    const currentStart = addDays(throughDate, -(policy.minimumCurrentDays - 1));
    const contributors = diagnosePaidMediaContributors(
      metrics.paidMediaEntities,
      currentStart,
      throughDate,
    );
    const recommendations = evaluatePaidMediaPortfolioRules(
      metrics.reconciliation,
      policy,
      contributors,
    );
    const expiresAt = `${addDays(throughDate, 7)} 23:59:59`;
    const persisted = [];

    for (const recommendation of recommendations) {
      const id = await ForesightRepository.createRecommendation(businessId, {
        fingerprint: recommendation.fingerprint,
        channel: recommendation.channel,
        subjectType: recommendation.subjectType,
        subjectId: recommendation.subjectId,
        ruleId: recommendation.ruleId,
        policyVersion: PAID_MEDIA_POLICY_VERSION,
        formulaVersion: PAID_MEDIA_RULE_FORMULA_VERSION,
        evidence: recommendation.evidence,
        proposedAction: recommendation.proposedAction,
        confidence: recommendation.confidence,
        expectedImpactLow: recommendation.expectedImpactLow,
        expectedImpactHigh: recommendation.expectedImpactHigh,
        expiresAt,
      });
      persisted.push({ id, ...recommendation });
    }

    const expiredCount = await ForesightRepository.expireSupersededShadowRecommendations(
      businessId,
      PAID_MEDIA_RULE_IDS,
      recommendations.map((recommendation) => recommendation.fingerprint),
    );

    return {
      evaluatedFrom: startDate,
      evaluatedThrough: throughDate,
      strategyVersion: policy.strategyVersion,
      contributorCount: contributors.length,
      recommendationCount: persisted.length,
      expiredCount,
      recommendations: persisted,
    };
  },
};