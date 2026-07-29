import { ForesightMetricsService } from './ForesightMetricsService';
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
];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const ForesightRecommendationService = {
  async evaluatePaidMedia(businessId: string, throughDate: string) {
    const startDate = addDays(throughDate, -13);
    const metrics = await ForesightMetricsService.getDailyMarketingMetrics(
      businessId,
      startDate,
      throughDate,
    );
    const recommendations = evaluatePaidMediaPortfolioRules(metrics.reconciliation);
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
      recommendationCount: persisted.length,
      expiredCount,
      recommendations: persisted,
    };
  },
};