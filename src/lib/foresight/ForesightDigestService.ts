import { buildDailyDigest, type DailyDigestSnapshot } from './dailyDigest';
import { ForesightMetricsService } from './ForesightMetricsService';
import { ForesightDigestRepository, type ForesightDigestRow } from './repositories/ForesightDigestRepository';
import { ForesightRepository } from './repositories/ForesightRepository';
import { buildWeeklyDigest, type WeeklyDigestSnapshot } from './weeklyDigest';

const DIGEST_STATES = [
  'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'compensated', 'rejected',
] as const;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const ForesightDigestService = {
  async generateDaily(businessId: string, digestDate: string): Promise<DailyDigestSnapshot> {
    const recommendations = await ForesightRepository.listRecommendations(businessId, [...DIGEST_STATES]);
    const recommendationIds = recommendations.map((item) => item.id);
    const [events, implementations, outcomes] = await Promise.all([
      ForesightRepository.listRecommendationEvents(businessId, recommendationIds),
      ForesightRepository.listRecommendationImplementations(businessId, recommendationIds),
      ForesightRepository.listRecommendationOutcomes(businessId, recommendationIds),
    ]);
    const snapshot = buildDailyDigest({
      digestDate, recommendations, events, implementations, outcomes,
    });
    await ForesightDigestRepository.upsertDaily(businessId, digestDate, snapshot);
    return snapshot;
  },

  async generateWeekly(businessId: string, digestDate: string): Promise<WeeklyDigestSnapshot> {
    const recommendations = await ForesightRepository.listRecommendations(
      businessId,
      [...DIGEST_STATES, 'expired'],
    );
    const recommendationIds = recommendations.map((item) => item.id);
    const metricStart = addDays(digestDate, -13);
    const [metrics, events, implementations, outcomes] = await Promise.all([
      ForesightMetricsService.getDailyMarketingMetrics(businessId, metricStart, digestDate),
      ForesightRepository.listRecommendationEvents(businessId, recommendationIds),
      ForesightRepository.listRecommendationImplementations(businessId, recommendationIds),
      ForesightRepository.listRecommendationOutcomes(businessId, recommendationIds),
    ]);
    const snapshot = buildWeeklyDigest({
      digestDate,
      reconciliation: metrics.reconciliation,
      paidMedia: metrics.paidMedia,
      paidMediaEntities: metrics.paidMediaEntities,
      recommendations,
      events,
      implementations,
      outcomes,
    });
    await ForesightDigestRepository.upsertWeekly(businessId, digestDate, snapshot);
    return snapshot;
  },

  async listRecent(businessId: string, limit = 7): Promise<ForesightDigestRow[]> {
    return ForesightDigestRepository.listRecent(businessId, limit);
  },

  async listRecentWeekly(businessId: string, limit = 8): Promise<Array<ForesightDigestRow<WeeklyDigestSnapshot>>> {
    return ForesightDigestRepository.listRecent<WeeklyDigestSnapshot>(businessId, limit, 'weekly_summary');
  },
};