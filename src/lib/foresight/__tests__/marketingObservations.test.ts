import { describe, expect, it } from 'vitest';
import { aggregateGoogleAdsDaily, aggregateMetaAdsDaily } from '../metrics/marketingObservations';

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
});