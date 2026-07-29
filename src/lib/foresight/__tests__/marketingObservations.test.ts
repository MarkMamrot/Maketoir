import { describe, expect, it } from 'vitest';
import {
  aggregateGoogleAdsDaily,
  aggregateGoogleAdsEntities,
  aggregateMetaAdsDaily,
  aggregateMetaAdsEntities,
} from '../metrics/marketingObservations';

describe('daily paid-media observations', () => {
  it('aggregates Google campaign rows by date and converts cost micros', () => {
    const observations = aggregateGoogleAdsDaily([
      {
        segments: { date: '2026-07-27' },
        customer: { currency_code: 'AUD' },
        metrics: { cost_micros: 1_250_000, impressions: 100, clicks: 8, conversions: 1, conversions_value: 40 },
      },
      {
        segments: { date: '2026-07-27' },
        customer: { currency_code: 'AUD' },
        metrics: { cost_micros: '750000', impressions: '50', clicks: '4', conversions: '0.5', conversions_value: '20' },
      },
    ], 'google-account');

    expect(observations).toEqual([{
      metricDate: '2026-07-27',
      source: 'google_ads',
      accountId: 'google-account',
      spend: 2,
      impressions: 150,
      clicks: 12,
      conversions: 1.5,
      attributedRevenue: 60,
      currencyCode: 'AUD',
    }]);
  });

  it('uses one preferred Meta purchase alias instead of double-counting overlapping actions', () => {
    const observations = aggregateMetaAdsDaily([{
      date_start: '2026-07-28',
      spend: '12.50',
      impressions: '1000',
      clicks: '20',
      actions: [
        { action_type: 'purchase', value: '3' },
        { action_type: 'omni_purchase', value: '3' },
      ],
      action_values: [
        { action_type: 'purchase', value: '150' },
        { action_type: 'omni_purchase', value: '150' },
      ],
    }], 'meta-account', 'AUD');

    expect(observations[0]).toMatchObject({
      spend: 12.5,
      impressions: 1000,
      clicks: 20,
      conversions: 3,
      attributedRevenue: 150,
      currencyCode: 'AUD',
    });
  });

  it('skips rows without a valid metric date', () => {
    expect(aggregateGoogleAdsDaily([{ segments: {}, metrics: { clicks: 1 } }], 'account')).toEqual([]);
    expect(aggregateMetaAdsDaily([{ date_start: 'not-a-date', clicks: 1 }], 'account')).toEqual([]);
  });

  it('keeps Google account totals separate from campaign-day observations', () => {
    const rows = [{
      campaign: { id: '101', name: 'Brand Search' },
      segments: { date: '2026-07-27' },
      customer: { currency_code: 'AUD' },
      metrics: { cost_micros: 2_000_000, impressions: 100, clicks: 10, conversions: 2, conversions_value: 80 },
    }, {
      campaign: { id: '202', name: 'Shopping' },
      segments: { date: '2026-07-27' },
      customer: { currency_code: 'AUD' },
      metrics: { cost_micros: 3_000_000, impressions: 200, clicks: 20, conversions: 3, conversions_value: 120 },
    }];

    expect(aggregateGoogleAdsDaily(rows, 'google-1')[0].spend).toBe(5);
    expect(aggregateGoogleAdsEntities(rows, 'google-1')).toMatchObject([
      { entityType: 'campaign', entityId: '101', entityName: 'Brand Search', spend: 2 },
      { entityType: 'campaign', entityId: '202', entityName: 'Shopping', spend: 3 },
    ]);
  });

  it('normalizes Meta ad sets with campaign parentage and purchase alias precedence', () => {
    const observations = aggregateMetaAdsEntities([{
      campaign_id: 'campaign-1',
      campaign_name: 'Prospecting',
      adset_id: 'adset-1',
      adset_name: 'Broad',
      date_start: '2026-07-27',
      spend: '25',
      actions: [{ action_type: 'omni_purchase', value: '2' }, { action_type: 'purchase', value: '9' }],
      action_values: [{ action_type: 'omni_purchase', value: '100' }],
    }], 'meta-1', 'adset', 'AUD');

    expect(observations[0]).toMatchObject({
      entityType: 'adset',
      entityId: 'adset-1',
      parentEntityId: 'campaign-1',
      spend: 25,
      conversions: 2,
      attributedRevenue: 100,
    });
  });
});