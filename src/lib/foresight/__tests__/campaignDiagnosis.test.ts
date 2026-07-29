import { describe, expect, it } from 'vitest';
import type { DailyPaidMediaEntityObservation } from '../metrics/marketingObservations';
import { diagnosePaidMediaContributors } from '../metrics/campaignDiagnosis';

function row(
  metricDate: string,
  entityId: string,
  entityName: string,
  spend: number,
  attributedRevenue: number,
  entityType: 'campaign' | 'adset' = 'campaign',
): DailyPaidMediaEntityObservation {
  return {
    metricDate,
    source: 'meta_ads',
    accountId: 'meta-1',
    entityType,
    entityId,
    entityName,
    parentEntityId: entityType === 'adset' ? 'campaign-1' : null,
    parentEntityName: entityType === 'adset' ? 'Prospecting' : null,
    spend,
    impressions: 100,
    clicks: 10,
    conversions: 1,
    attributedRevenue,
    currencyCode: 'AUD',
  };
}

describe('campaign diagnosis', () => {
  it('ranks spend exposure and platform ROAS deterioration without claiming backend attribution', () => {
    const contributors = diagnosePaidMediaContributors([
      row('2026-07-21', 'campaign-1', 'Prospecting', 100, 400),
      row('2026-07-28', 'campaign-1', 'Prospecting', 150, 150),
      row('2026-07-21', 'campaign-2', 'Brand', 50, 250),
      row('2026-07-28', 'campaign-2', 'Brand', 50, 250),
    ], '2026-07-22', '2026-07-28');

    expect(contributors[0]).toMatchObject({
      entityName: 'Prospecting',
      currentSpend: 150,
      previousSpend: 100,
      currentPlatformRoas: 1,
      previousPlatformRoas: 4,
      platformRoasChangePercent: -75,
    });
    expect(contributors[0].signals).toEqual(['spend_increase', 'platform_roas_decline']);
  });

  it('returns separate ranked campaign and ad-set evidence and excludes inactive entities', () => {
    const contributors = diagnosePaidMediaContributors([
      row('2026-07-21', 'old', 'Old campaign', 100, 100),
      row('2026-07-28', 'campaign-1', 'Prospecting', 50, 0),
      row('2026-07-28', 'adset-1', 'Broad', 50, 0, 'adset'),
    ], '2026-07-22', '2026-07-28');

    expect(contributors.map((item) => item.entityType)).toEqual(['campaign', 'adset']);
    expect(contributors.some((item) => item.entityId === 'old')).toBe(false);
    expect(contributors[0].signals).toContain('spend_without_platform_revenue');
  });
});