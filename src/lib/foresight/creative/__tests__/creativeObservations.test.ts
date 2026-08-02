import { describe, expect, it } from 'vitest';
import { normalizeGoogleCreativeObservations, normalizeMetaCreativeObservations } from '../creativeObservations';

describe('creative observations', () => {
  it('keeps Google ad and asset identities separate with stable entity links', () => {
    const observations = normalizeGoogleCreativeObservations({
      accountId: '123', windowStart: '2026-08-01', windowEnd: '2026-08-02',
      rows: [{
        segments: { date: '2026-08-02' }, customer: { currency_code: 'AUD' },
        campaign: { id: '10', name: 'Search' }, ad_group: { id: '20', name: 'Brand' },
        ad_group_ad: { status: 'ENABLED', ad: { id: '30', type: 'RESPONSIVE_SEARCH_AD', final_urls: ['https://example.com'], responsive_search_ad: { headlines: [{ text: 'Fresh stock' }], descriptions: [{ text: 'Shop today' }] } } },
        metrics: { impressions: 100, clicks: 5, cost_micros: 2_500_000, conversions: 1, conversions_value: 20 },
      }],
      assetRows: [{
        segments: { date: '2026-08-02' }, campaign: { id: '10', name: 'Search' }, ad_group: { id: '20', name: 'Brand' },
        ad_group_ad: { ad: { id: '30' } }, asset: { id: '40', type: 'TEXT', text_asset: { text: 'Fresh stock' } },
        ad_group_ad_asset_view: { field_type: 'HEADLINE', performance_label: 'BEST' }, metrics: { impressions: 80, clicks: 4 },
      }],
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ externalId: '30', creativeKind: 'ad', copy: { headlines: ['Fresh stock'] }, metrics: [{ spend: 2.5 }] });
    expect(observations[1]).toMatchObject({ externalId: '40', creativeKind: 'asset', format: 'TEXT', links: expect.arrayContaining([{ entityType: 'ad', entityId: '30', entityName: null }]) });
  });

  it('normalizes Meta creative identity, safe media references, and purchase diagnostics', () => {
    const observations = normalizeMetaCreativeObservations({
      accountId: 'act_123', windowStart: '2026-08-01', windowEnd: '2026-08-01',
      rows: [{
        date_start: '2026-08-01', campaign_id: '10', campaign_name: 'Prospecting', adset_id: '20', adset_name: 'Broad',
        ad_id: '30', ad_name: 'Winter video', creative_id: '40', body: 'Warm up', title: 'Winter range', video_id: '50', object_story_id: 'page_60',
        impressions: '1000', clicks: '20', spend: '40.50', reach: '800', frequency: '1.25',
        video_thruplay_watched_actions: [{ action_type: 'video_view', value: '600' }],
        actions: [{ action_type: 'purchase', value: '3' }], action_values: [{ action_type: 'purchase', value: '120' }], account_currency: 'AUD',
      }],
    });

    expect(observations).toEqual([expect.objectContaining({
      externalId: '40', creativeKind: 'creative', copy: { body: 'Warm up', title: 'Winter range' },
      media: { imageHash: null, videoId: '50', objectStoryId: 'page_60' },
      metrics: [expect.objectContaining({ spend: 40.5, conversions: 3, attributedRevenue: 120, frequency: 1.25, videoViews: 600 })],
    })]);
  });

  it('consolidates a reused creative without adding non-additive reach or frequency', () => {
    const base = { date_start: '2026-08-01', campaign_id: '10', adset_id: '20', creative_id: '40',
      impressions: '100', clicks: '5', spend: '10', reach: '80', frequency: '1.25', account_currency: 'AUD' };
    const [observation] = normalizeMetaCreativeObservations({ accountId: '123', windowStart: '2026-08-01', windowEnd: '2026-08-01',
      rows: [{ ...base, ad_id: '30' }, { ...base, ad_id: '31' }] });

    expect(observation.links.filter((link) => link.entityType === 'ad')).toHaveLength(2);
    expect(observation.metrics).toEqual([expect.objectContaining({ impressions: 200, spend: 20, clicks: 10, reach: null, frequency: null })]);
  });
});
