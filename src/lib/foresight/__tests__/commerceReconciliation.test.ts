import { describe, expect, it } from 'vitest';
import { reconcileDailyCommerce, type DailyCommerceObservation } from '../metrics/commerceReconciliation';

function observation(overrides: Partial<DailyCommerceObservation>): DailyCommerceObservation {
  return {
    metricDate: '2026-07-28',
    channel: 'online',
    salesIncTax: 1_100,
    salesTax: 100,
    returnsIncTax: 110,
    returnsTax: 10,
    salesCogs: 400,
    returnedCogs: 40,
    orderCount: 10,
    returnCount: 1,
    costLineCount: 20,
    missingCostLineCount: 0,
    costBasis: 'captured',
    ...overrides,
  };
}

describe('daily commerce reconciliation', () => {
  it('uses online backend revenue for MER and keeps POS revenue as separate context', () => {
    const result = reconcileDailyCommerce([
      observation({}),
      observation({
        channel: 'pos',
        salesIncTax: 550,
        salesTax: 50,
        returnsIncTax: 0,
        returnsTax: 0,
        salesCogs: 200,
        returnedCogs: 0,
        costBasis: 'estimated',
      }),
    ], [
      {
        metricDate: '2026-07-28', source: 'google_ads', accountId: 'google',
        spend: 100, impressions: 0, clicks: 0, conversions: 0, attributedRevenue: 0, currencyCode: 'AUD',
      },
      {
        metricDate: '2026-07-28', source: 'meta_ads', accountId: 'meta',
        spend: 100, impressions: 0, clicks: 0, conversions: 0, attributedRevenue: 0, currencyCode: 'AUD',
      },
    ]);

    expect(result[0].onlineNetRevenueExTax).toBe(900);
    expect(result[0].posNetRevenueExTax).toBe(500);
    expect(result[0].totalRetailNetRevenueExTax).toBe(1_400);
    expect(result[0].paidMedia.paidMediaMer.value).toBe(4.5);
    expect(result[0].onlineContribution.contributionPoas.value).toBe(2.7);
  });

  it('blocks contribution metrics but preserves revenue and MER when COGS coverage is incomplete', () => {
    const result = reconcileDailyCommerce([
      observation({ missingCostLineCount: 1 }),
    ], [{
      metricDate: '2026-07-28', source: 'google_ads', accountId: 'google',
      spend: 100, impressions: 0, clicks: 0, conversions: 0, attributedRevenue: 0, currencyCode: 'AUD',
    }]);

    expect(result[0].onlineNetRevenueExTax).toBe(900);
    expect(result[0].paidMedia.paidMediaMer.value).toBe(9);
    expect(result[0].onlineContribution.contributionPoas.value).toBeNull();
    expect(result[0].onlineContribution.contributionPoas.quality.grade).toBe('blocked');
    expect(result[0].qualityIssues).toContainEqual(expect.objectContaining({ code: 'incomplete_online_cogs' }));
  });
});