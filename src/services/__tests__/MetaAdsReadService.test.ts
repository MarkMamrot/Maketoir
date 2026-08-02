import { describe, expect, it, vi } from 'vitest';
import { MetaAdsReadService } from '../MetaAdsReadService';

function sdkFixture() {
  const reads: Array<{ kind: string; id: string; fields: string[]; api: unknown }> = [];
  const updates: Array<{ kind: string; id: string; fields: string[]; params: Record<string, unknown>; api: unknown }> = [];
  const creates: Array<{ kind: string; id: string; fields: string[]; params: Record<string, unknown>; api: unknown }> = [];
  const deletes: Array<{ kind: string; id: string; api: unknown }> = [];
  const records: Record<string, Record<string, unknown>> = {
    'account:act_123': { id: 'act_123', account_id: '123', account_status: 1, currency: 'aud', business: { id: 'business-456' } },
    'campaign:campaign-1': { id: 'campaign-1', account_id: '123', name: 'Prospecting', configured_status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000' },
    'campaign:campaign-2': { id: 'campaign-2', account_id: '123', name: 'Treatment offer', objective: 'OUTCOME_SALES', configured_status: 'PAUSED', effective_status: 'PAUSED' },
    'adset:adset-1': { id: 'adset-1', account_id: '123', campaign_id: 'campaign-1', name: 'Broad', configured_status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' },
    'study:study-1': { id: 'study-1', business: { id: '456' }, name: 'Offer test', type: 'SPLIT_TEST', start_time: '2026-08-01T00:00:00+0000', end_time: '2026-08-08T00:00:00+0000' },
  };
  const campaigns = [
    { id: 'campaign-1', account_id: '123', name: 'Control offer', objective: 'OUTCOME_SALES', configured_status: 'PAUSED', effective_status: 'PAUSED' },
    { id: 'campaign-2', account_id: '123', name: 'Treatment offer', objective: 'OUTCOME_SALES', configured_status: 'PAUSED', effective_status: 'PAUSED' },
  ];
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
      async update(fields: string[], params: Record<string, unknown>) {
        updates.push({ kind, id, fields, params, api: suppliedApi });
        return { success: true };
      },
      async getCampaigns(fields: string[], params: Record<string, unknown>) {
        reads.push({ kind: 'campaign-list', id, fields, api: suppliedApi });
        return campaigns.slice(0, Number(params.limit));
      },
      async getCells(fields: string[], params: Record<string, unknown>) {
        reads.push({ kind: 'cell-list', id, fields, api: suppliedApi });
        void params;
        return [
          { id: 'cell-1', name: 'Control', treatment_percentage: 50, campaigns: { data: [{ id: 'campaign-1' }] } },
          { id: 'cell-2', name: 'Treatment', treatment_percentage: 50, campaigns: { data: [{ id: 'campaign-2' }] } },
        ];
      },
      async createAdStudy(fields: string[], params: Record<string, unknown>) {
        creates.push({ kind, id, fields, params, api: suppliedApi });
        return { id: 'study-1' };
      },
      async getAdStudies(fields: string[], params: Record<string, unknown>) {
        reads.push({ kind: 'study-list', id, fields, api: suppliedApi });
        void params;
        return [{ id: 'study-1', name: 'Offer test', type: 'SPLIT_TEST' }];
      },
      async delete() {
        deletes.push({ kind, id, api: suppliedApi });
        return { success: true };
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
  const Business = vi.fn(function (this: unknown, id: string, _data: object, _parent: string, suppliedApi: unknown) {
    return readable('business', id, suppliedApi);
  });
  const AdStudy = vi.fn(function (this: unknown, id: string, _data: object, _parent: string, suppliedApi: unknown) {
    return readable('study', id, suppliedApi);
  });
  return { sdk: { FacebookAdsApi, AdAccount, Campaign, AdSet, Business, AdStudy }, reads, updates, creates, deletes };
}

describe('MetaAdsReadService', () => {
  it('creates, reads back, and cancels an exact tenant-bound campaign split test', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    const snapshot = await service.createSplitTest({
      businessId: '456', name: 'Offer test', description: 'Accepted experiment 7',
      startTime: 1_785_542_400, endTime: 1_786_147_200,
      control: { campaignId: 'campaign-1', name: 'Control', allocationPercent: 50 },
      treatment: { campaignId: 'campaign-2', name: 'Treatment', allocationPercent: 50 },
    });
    await service.cancelSplitTest(snapshot.studyId);

    expect(fixture.creates[0]).toMatchObject({ kind: 'business', id: '456', params: {
      name: 'Offer test', type: 'SPLIT_TEST', start_time: 1_785_542_400, end_time: 1_786_147_200,
      cells: [
        { name: 'Control', treatment_percentage: 50, campaigns: ['campaign-1'] },
        { name: 'Treatment', treatment_percentage: 50, campaigns: ['campaign-2'] },
      ],
    } });
    expect(snapshot).toMatchObject({ studyId: 'study-1', businessId: '456', type: 'SPLIT_TEST', cells: [
      { cellId: 'cell-1', allocationPercent: 50, campaignIds: ['campaign-1'] },
      { cellId: 'cell-2', allocationPercent: 50, campaignIds: ['campaign-2'] },
    ] });
    expect(fixture.deletes).toHaveLength(1);
    expect([...fixture.creates, ...fixture.reads, ...fixture.deletes].every(({ api }) => (api as { token: string }).token === 'tenant-token')).toBe(true);
  });

  it('finds an existing exact split test without creating another one', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);
    const snapshot = await service.findSplitTestByName('456', 'Offer test');
    expect(snapshot?.studyId).toBe('study-1');
    expect(fixture.creates).toEqual([]);
    expect(fixture.reads[0]).toMatchObject({ kind: 'study-list', id: '456' });
  });

  it('rejects invalid split-test input before submitting a Meta mutation', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);
    await expect(service.createSplitTest({
      businessId: '456', name: 'Offer test', description: '', startTime: 100, endTime: 200,
      control: { campaignId: 'campaign-1', name: 'Control', allocationPercent: 60 },
      treatment: { campaignId: 'campaign-1', name: 'Treatment', allocationPercent: 40 },
    })).rejects.toThrow('distinct campaign IDs');
    expect(fixture.creates).toEqual([]);
  });

  it('resolves the owning Business Manager through the tenant API', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    await expect(service.getExperimentAccountIdentity()).resolves.toEqual({ accountId: '123', businessId: 'business-456' });
    expect((fixture.reads[0].api as { token: string }).token).toBe('tenant-token');
  });

  it('reads and updates exact campaign statuses through the tenant API', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    const statuses = await service.getCampaignStatuses(['campaign-2', 'campaign-2']);
    await service.updateCampaignStatuses([
      { campaignId: 'campaign-1', status: 'ACTIVE' },
      { campaignId: 'campaign-2', status: 'ACTIVE' },
    ]);

    expect(statuses).toEqual([{ campaignId: 'campaign-2', accountId: '123', campaignName: 'Treatment offer', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' }]);
    expect(fixture.updates.map(({ id, params }) => ({ id, params }))).toEqual([
      { id: 'campaign-1', params: { status: 'ACTIVE' } },
      { id: 'campaign-2', params: { status: 'ACTIVE' } },
    ]);
    expect(fixture.updates.every(({ api }) => (api as { token: string }).token === 'tenant-token')).toBe(true);
  });

  it('rejects duplicate campaign status mutations before submitting them', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    await expect(service.updateCampaignStatuses([
      { campaignId: 'campaign-1', status: 'ACTIVE' },
      { campaignId: 'campaign-1', status: 'PAUSED' },
    ])).rejects.toThrow('distinct campaign IDs');
    expect(fixture.updates).toEqual([]);
  });

  it('lists bounded campaign identities through the tenant API without mutation', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);
    const result = await service.listCampaigns(2);

    expect(result).toEqual([
      { campaignId: 'campaign-1', accountId: '123', campaignName: 'Control offer', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
      { campaignId: 'campaign-2', accountId: '123', campaignName: 'Treatment offer', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
    ]);
    expect(fixture.reads[0]).toMatchObject({ kind: 'campaign-list', id: 'act_123' });
    expect((fixture.reads[0].api as { token: string }).token).toBe('tenant-token');
    expect(fixture.updates).toEqual([]);
  });

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

  it('updates explicit campaign and ad-set daily budgets through the tenant API', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    await service.updateDailyBudgets([
      { entityType: 'campaign', entityId: 'campaign-1', dailyBudgetMinor: 9_200 },
      { entityType: 'adset', entityId: 'adset-1', dailyBudgetMinor: 4_600 },
    ]);

    expect(fixture.updates.map(update => ({ kind: update.kind, id: update.id, params: update.params }))).toEqual([
      { kind: 'campaign', id: 'campaign-1', params: { daily_budget: 9_200 } },
      { kind: 'adset', id: 'adset-1', params: { daily_budget: 4_600 } },
    ]);
    expect(fixture.updates.every(update => (update.api as { token: string }).token === 'tenant-token')).toBe(true);
  });

  it('rejects invalid daily budgets before submitting a Meta mutation', async () => {
    const fixture = sdkFixture();
    const service = new MetaAdsReadService('tenant-token', '123', fixture.sdk as never);

    await expect(service.updateDailyBudgets([
      { entityType: 'campaign', entityId: 'campaign-1', dailyBudgetMinor: 0 },
    ])).rejects.toThrow('positive integer');
    expect(fixture.updates).toEqual([]);
  });
});