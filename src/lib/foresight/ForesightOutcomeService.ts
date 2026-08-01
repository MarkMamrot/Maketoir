import { ForesightMetricsService } from './ForesightMetricsService';
import {
  assessPaidMediaRecommendationOutcome,
  summarizePaidMediaOutcomeWindow,
} from './recommendationOutcomes';
import { ForesightRepository } from './repositories/ForesightRepository';
import { assessCampaignOutcome, summarizeCampaignOutcomeWindow } from './campaignOutcomes';
import { ForesightCampaignActivationRepository } from './repositories/ForesightCampaignActivationRepository';
import { PAID_MEDIA_OUTCOME_HORIZON_DAYS } from './marketingOperationalStatus';

export { PAID_MEDIA_OUTCOME_HORIZON_DAYS } from './marketingOperationalStatus';

function addDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const ForesightOutcomeService = {
  async evaluateDueCampaigns(businessId: string, throughDate: string) {
    const candidates = await ForesightCampaignActivationRepository.listDue(businessId, throughDate);
    const outcomes = [];
    let deferredCount = 0;

    for (const activation of candidates) {
      const [baselineMetrics, followupMetrics] = await Promise.all([
        ForesightMetricsService.getDailyMarketingMetrics(
          businessId,
          activation.baseline_start,
          activation.baseline_end,
        ),
        ForesightMetricsService.getDailyMarketingMetrics(
          businessId,
          activation.followup_start,
          activation.followup_end,
        ),
      ]);
      const assessment = assessCampaignOutcome(
        summarizeCampaignOutcomeWindow(baselineMetrics.reconciliation),
        summarizeCampaignOutcomeWindow(followupMetrics.reconciliation),
        activation.horizon_days,
      );
      if (assessment.direction === 'unavailable') {
        deferredCount += 1;
        continue;
      }
      const id = await ForesightCampaignActivationRepository.createOutcome(businessId, {
        activation,
        assessment,
      });
      outcomes.push({ id, activationId: activation.id, assessment });
    }

    return {
      throughDate,
      candidateCount: candidates.length,
      measuredCount: outcomes.length,
      deferredCount,
      outcomes,
    };
  },

  async evaluateDuePaidMedia(businessId: string, throughDate: string) {
    const candidates = await ForesightRepository.listRecommendationOutcomeCandidates(
      businessId,
      throughDate,
      PAID_MEDIA_OUTCOME_HORIZON_DAYS,
    );
    const outcomes = [];
    let deferredCount = 0;

    for (const candidate of candidates) {
      const referenceDate = candidate.reference_at.slice(0, 10);
      const followupStart = addDays(referenceDate, 1);
      const followupEnd = addDays(referenceDate, PAID_MEDIA_OUTCOME_HORIZON_DAYS);
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