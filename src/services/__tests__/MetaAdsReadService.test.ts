import { describe, expect, it, vi } from 'vitest';
import { MetaAdsReadService } from '../MetaAdsReadService';

function sdkFixture() {
  const reads: Array<{ kind: string; id: string; fields: string[]; api: unknown }> = [];
  const records: Record<string, Record<string, unknown>> = {
    'account:act_123': { id: 'act_123', account_id: '123', account_status: 1, currency: 'aud' },
    'campaign:campaign-1': { id: 'campaign-1', account_id: '123', name: 'Prospecting', configured_status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000' },
    'adset:adset-1': { id: 'adset-1', account_id: '123', campaign_id: 'campaign-1', name: 'Broad', configured_status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' },
  };
  const api = { tenantClient: true };
  class FacebookAdsApi {
    constructor(public token: string) { Object.assign(this, api); }
  }
  function readable(kind: string, id: string, suppliedApi: unknown) {
    return {
      async read(fields: string[]) {
        reads.push({ kind, id, fields, api: suppliedApi });
        return { exportData: () => records[`${kind}:${id}`] ?? {} };
      },
    };
  }
  const AdAccount = vi.fn(function (this: unknown, id: string, _data: object, _parent: string, suppliedApi: unknown) {
    return readable('account', id, suppliedApi);
  });
  const Campaign = vi.fn(function (this: unknown, id: string, _data: object, _parent: string, suppliedApi: unknown) {
    return readable('campaign', id, suppliedApi);
  });
  const AdSet = vi.fn(function (this: unknown, id: string, _data: object, _parent: string, suppliedApi: unknown) {
    return readable('adset', id, suppliedApi);
  });
  return { sdk: { FacebookAdsApi, AdAccount, Campaign, AdSet }, reads };
}

describe('MetaAdsReadService', () => {
  it('uses explicit tenant API instances and reads ad-set parent campaign settings', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);
    const result = await service.getBudgetSettings({ campaignIds: [], adSetIds: ['adset-1'] });

    expect(result.account).toEqual({ accountId: '123', accountStatus: 1, currencyCode: 'AUD' });
    expect(result.adSets[0]).toMatchObject({ adSetId: 'adset-1', campaignId: 'campaign-1', dailyBudgetMinor: 5000 });
    expect(result.campaigns[0]).toMatchObject({ campaignId: 'campaign-1', dailyBudgetMinor: 10000 });
    expect(fixture.reads.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'account:act_123', 'adset:adset-1', 'campaign:campaign-1',
    ]);
    expect(fixture.reads.every((read) => (read.api as { token: string }).token === 'tenant-token')).toBe(true);
  });

  it('rejects malformed account IDs before creating an SDK request', () => {
    const fixture = sdkFixture();
    expect(() => new MetaAdsReadService('tenant-token', 'not-an-account', fixture.sdk as never))
      .toThrow('digits only');
    expect(fixture.reads).toEqual([]);
  });
});