import { reconcileDailyCommerce } from './metrics/commerceReconciliation';
import { ForesightIngestionRepository } from './repositories/ForesightIngestionRepository';

export const ForesightMetricsService = {
  async getDailyMarketingMetrics(businessId: string, startDate: string, endDate: string) {
    const [paidMedia, paidMediaEntities, commerce] = await Promise.all([
      ForesightIngestionRepository.getLatestPaidMediaTrend(businessId, startDate, endDate),
      ForesightIngestionRepository.getLatestPaidMediaEntityTrend(businessId, startDate, endDate),
      ForesightIngestionRepository.getLatestCommerceTrend(businessId, startDate, endDate),
    ]);

    return {
      paidMedia,
      paidMediaEntities,
      commerce,
      reconciliation: reconcileDailyCommerce(commerce, paidMedia),
    };
  },
};