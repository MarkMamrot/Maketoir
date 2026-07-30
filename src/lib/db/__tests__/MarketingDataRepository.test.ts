import { describe, expect, it } from 'vitest';
import { marketingEntityIdentity, normalizeMarketingRecordDate } from '../MarketingDataRepository';

describe('MarketingDataRepository helpers', () => {
  it('normalizes GA4 compact daily and monthly dates', () => {
    expect(normalizeMarketingRecordDate('20260729', '2026-01-01')).toBe('2026-07-29');
    expect(normalizeMarketingRecordDate('202607', '2026-01-01')).toBe('2026-07-01');
  });

  it('uses all GA4 dimensions to prevent same-date channel collisions', () => {
    const headers = ['date', 'sessionDefaultChannelGroup', 'sessionSource', 'sessions', 'conversions'];
    const direct = marketingEntityIdentity(headers, ['20260729', 'Direct', '(direct)', '10', '1']);
    const organic = marketingEntityIdentity(headers, ['20260729', 'Organic Search', 'google', '20', '2']);

    expect(direct.id).not.toBe(organic.id);
    expect(direct.name).toBe('Direct');
    expect(organic.name).toBe('Organic Search');
  });

  it('preserves legacy first-column identity when no GA4 metric boundary exists', () => {
    expect(marketingEntityIdentity(['campaign.id', 'campaign.name'], ['123', 'Brand'])).toEqual({
      id: '123',
      name: 'Brand',
    });
  });
});