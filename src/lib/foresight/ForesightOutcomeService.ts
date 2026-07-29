import { ForesightMetricsService } from './ForesightMetricsService';
import {
  assessPaidMediaRecommendationOutcome,
  summarizePaidMediaOutcomeWindow,
} from './recommendationOutcomes';
import { ForesightRepository } from './repositories/ForesightRepository';

export const PAID_MEDIA_OUTCOME_HORIZON_DAYS = 7;

function addDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const ForesightOutcomeService = {
  async evaluateDuePaidMedia(businessId: string, throughDate: string) {
    const candidates = await ForesightRepository.listRecommendationOutcomeCandidates(
      businessId,
      throughDate,
      PAID_MEDIA_OUTCOME_HORIZON_DAYS,
    );
    const outcomes = [];
    let deferredCount = 0;

    for (const candidate of candidates) {
      const decisionDate = candidate.decided_at.slice(0, 10);
      const followupStart = addDays(decisionDate, 1);
      const followupEnd = addDays(decisionDate, PAID_MEDIA_OUTCOME_HORIZON_DAYS);
      const metrics = await ForesightMetricsService.getDailyMarketingMetrics(
        businessId,
        followupStart,
        followupEnd,
      );
      if (new Set(metrics.reconciliation.map((row) => row.metricDate)).size < PAID_MEDIA_OUTCOME_HORIZON_DAYS) {
        deferredCount += 1;
        continue;
      }

      const assessment = assessPaidMediaRecommendationOutcome(
        candidate.rule_id,
        candidate.evidence_json.observedValues ?? {},
        summarizePaidMediaOutcomeWindow(metrics.reconciliation),
      );
      if (assessment.direction === 'unavailable') {
        deferredCount += 1;
        continue;
      }

      const id = await ForesightRepository.createRecommendationOutcome(businessId, {
        recommendationId: candidate.id,
        decision: candidate.decision,
        horizonDays: PAID_MEDIA_OUTCOME_HORIZON_DAYS,
        baselineStart: candidate.evidence_json.windowStart,
        baselineEnd: candidate.evidence_json.windowEnd,
        followupStart,
        followupEnd,
        assessment,
      });
      outcomes.push({ id, recommendationId: candidate.id, assessment });
    }

    return {
      throughDate,
      candidateCount: candidates.length,
      measuredCount: outcomes.length,
      deferredCount,
      outcomes,
    };
  },
};