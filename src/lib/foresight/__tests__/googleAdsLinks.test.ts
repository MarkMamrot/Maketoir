import { describe, expect, it } from 'vitest';
import { googleAdsCampaignUrl } from '../googleAdsLinks';

describe('googleAdsCampaignUrl', () => {
  it('builds an account-scoped campaign link', () => {
    expect(googleAdsCampaignUrl('111-222-3333', '18309541386'))
      .toBe('https://ads.google.com/aw/campaigns?campaignId=18309541386&__c=1112223333');
  });

  it('refuses malformed account and campaign identifiers', () => {
    expect(googleAdsCampaignUrl('', '18309541386')).toBeNull();
    expect(googleAdsCampaignUrl('1112223333', 'campaign-1')).toBeNull();
  });
});