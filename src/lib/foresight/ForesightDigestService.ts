import { buildDailyDigest, type DailyDigestSnapshot } from './dailyDigest';
import { ForesightDigestRepository, type ForesightDigestRow } from './repositories/ForesightDigestRepository';
import { ForesightRepository } from './repositories/ForesightRepository';

const DIGEST_STATES = [
  'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'compensated', 'rejected',
] as const;

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

  async listRecent(businessId: string, limit = 7): Promise<ForesightDigestRow[]> {
    return ForesightDigestRepository.listRecent(businessId, limit);
  },
};