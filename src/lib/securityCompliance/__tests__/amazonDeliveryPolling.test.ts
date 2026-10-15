import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(), query: vi.fn(), execute: vi.fn(), release: vi.fn(), credentials: vi.fn(), track: vi.fn(), save: vi.fn(), report: vi.fn(), pool: vi.fn(), settings: vi.fn(),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, getIMSPool: mocks.pool }));
vi.mock('@/lib/ims/shipping/shippingSettingsRepository', () => ({ ShippingSettingsRepository: { getAccountCredentials: mocks.credentials } }));
vi.mock('@/lib/ims/shipping/deliveryTrackingSettingsRepository', () => ({ getDeliveryTrackingChannels: mocks.settings }));
vi.mock('@/lib/ims/shipping/carriers/auspostEparcel/client', () => ({
  AusPostEparcelClient: class { trackArticles = mocks.track; },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('../amazonDeliveryEvidenceRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../amazonDeliveryEvidenceRepository')>();
  return { ACTIVE_DELIVERY_EVIDENCE_SQL: actual.ACTIVE_DELIVERY_EVIDENCE_SQL, saveCarrierDeliveryEvidence: mocks.save };
});
import { pollOnlineChannelDeliveryEvidence } from '../amazonDeliveryPolling';

let tenant: string | null;
let orderChannel: string;
beforeEach(() => {
  vi.clearAllMocks(); tenant = null; orderChannel = 'amazon';
  mocks.settings.mockImplementation(async (businessId: string) => {
    expect(tenant).toBe(businessId);
    return { amazon: true, shopify: false, native_shop: false };
  });
  mocks.run.mockImplementation(async (businessId: string, callback: () => Promise<unknown>) => {
    tenant = businessId;
    try { return await callback(); } finally { tenant = null; }
  });
  mocks.pool.mockImplementation(() => {
    expect(tenant).toBe('tenant-a');
    return { getConnection: async () => ({ execute: mocks.execute, release: mocks.release }) };
  });
  mocks.query.mockImplementation(async (_sql: string, params: unknown[]) => {
    expect(tenant).toBe('tenant-a'); expect(params[0]).toBe('tenant-a');
    return params.slice(1).includes(orderChannel)
      ? [{ id: 9, so_id: 42, shipment_id: 8, carrier_account_id: 5, article_id: 'ARTICLE1' }] : [];
  });
  mocks.execute.mockImplementation(async (_sql: string, params: unknown[]) => {
    expect(tenant).toBe('tenant-a'); expect(params).toContain('tenant-a');
    return [{ affectedRows: 1 }];
  });
  mocks.credentials.mockResolvedValue({ provider: 'auspost_eparcel', accountNumber: '0000123456', apiKey: 'PRIVATE KEY', password: 'PRIVATE PASSWORD' });
  mocks.track.mockResolvedValue([{ articleId: 'ARTICLE1', outcome: 'delivered', deliveredAt: '2025-09-01T00:00:00.000Z', errorCode: null }]);
  mocks.save.mockResolvedValue(7); mocks.report.mockResolvedValue(null);
});

describe('bounded automatic original-delivery polling', () => {
  it('polls tenant-owned dispatched Amazon articles and saves only normalized evidence', async () => {
    const result = await pollOnlineChannelDeliveryEvidence('tenant-a');
    expect(result).toEqual({ attempted: 1, delivered: 1, pending: 0, failed: 0, deferred: 0 });
    expect(mocks.credentials).toHaveBeenCalledWith('tenant-a', 5);
    expect(mocks.track).toHaveBeenCalledWith(['ARTICLE1']);
    expect(mocks.save).toHaveBeenCalledWith({ businessId: 'tenant-a', salesOrderId: 42, parcelId: 9,
      articleId: 'ARTICLE1', deliveredAt: '2025-09-01T00:00:00.000Z' });
    const selection = mocks.query.mock.calls[0][0];
    expect(selection).toContain('o.sales_channel IN (?)');
    expect(mocks.query.mock.calls[0][1]).toEqual(['tenant-a', 'amazon']);
    expect(selection).toContain('s.ims_fulfilled_at IS NOT NULL');
    expect(selection).toContain('s.voided_at IS NULL');
    expect(selection).toContain('NOT EXISTS');
    expect(selection).toContain('LIMIT 20');
    expect(mocks.execute.mock.calls.every(([sql]) => /^(INSERT INTO|UPDATE) ims_amazon_delivery_poll_state/.test(sql))).toBe(true);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('keeps pending articles distinct from failures without inventing delivery dates', async () => {
    mocks.track.mockResolvedValueOnce([{ articleId: 'ARTICLE1', outcome: 'pending', deliveredAt: null, errorCode: null }]);
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ pending: 1, delivered: 0, failed: 0 });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.find(([sql]) => sql.includes('last_checked_at'))?.[1].slice(0, 3)).toEqual([6, 'pending', null]);
  });
  it('surfaces per-article errors and retains only a safe status code', async () => {
    mocks.track.mockResolvedValueOnce([{ articleId: 'ARTICLE1', outcome: 'error', deliveredAt: null, errorCode: 'article_not_found' }]);
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ failed: 1, delivered: 0 });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'verify_parcel_delivery',
      context: { salesOrderId: 42, parcelId: 9, errorCode: 'article_not_found' },
    }));
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('PRIVATE');
  });
  it('reports missing credential access and request failures instead of empty success', async () => {
    mocks.credentials.mockResolvedValueOnce(null);
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ failed: 1 });
    expect(mocks.track).not.toHaveBeenCalled();
    mocks.track.mockRejectedValueOnce(new Error('Transport failure'));
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ failed: 1 });
    expect(mocks.report).toHaveBeenCalledTimes(2);
  });
  it('does not poll a concurrently claimed parcel', async () => {
    mocks.execute.mockImplementation(async (sql: string) => [{ affectedRows: sql.includes('SET locked_until') ? 0 : 1 }]);
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ attempted: 0, deferred: 1 });
    expect(mocks.track).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('defers work outside the budget without calling a carrier or leaving a claim behind', async () => {
    const times = new Map([[await import('node:crypto').then(({ createHash }) => createHash('sha256').update('PRIVATE KEY').digest('hex')), Date.now()]]);
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a', times, Date.now() + 31_000)).toMatchObject({ deferred: 1 });
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('SET locked_until = NULL'))).toBe(true);
  });
  it('never reports success when the carrier evidence fails to persist', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Evidence transaction failed'));
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ delivered: 0, failed: 1 });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'verify_parcel_delivery' }));
  });
  it.each(['shopify', 'native_shop'])('polls dispatched %s parcels only when that type is enabled', async provider => {
    orderChannel = provider;
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ attempted: 0, delivered: 0 });
    expect(mocks.track).not.toHaveBeenCalled();
    mocks.settings.mockResolvedValueOnce({ amazon: false, shopify: provider === 'shopify', native_shop: provider === 'native_shop' });
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ attempted: 1, delivered: 1 });
    expect(mocks.query.mock.calls.at(-1)?.[1]).toEqual(['tenant-a', provider]);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', salesOrderId: 42 }));
  });
  it('skips every carrier, lease and parcel query when all types are Off', async () => {
    mocks.settings.mockResolvedValueOnce({ amazon: false, shopify: false, native_shop: false });
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toEqual({ attempted: 0, delivered: 0, pending: 0, failed: 0, deferred: 0 });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled(); expect(mocks.track).not.toHaveBeenCalled();
  });
  it('never falls back to enabled tracking if settings cannot be loaded', async () => {
    mocks.settings.mockRejectedValueOnce(new Error('Saved settings are invalid'));
    await expect(pollOnlineChannelDeliveryEvidence('tenant-a')).rejects.toThrow('Saved settings are invalid');
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.track).not.toHaveBeenCalled();
  });
  it('does not poll retail or wholesale orders even when every online type is enabled', async () => {
    mocks.settings.mockResolvedValueOnce({ amazon: true, shopify: true, native_shop: true });
    orderChannel = 'retail';
    expect(await pollOnlineChannelDeliveryEvidence('tenant-a')).toMatchObject({ attempted: 0 });
    expect(mocks.query.mock.calls[0][1]).toEqual(['tenant-a', 'shopify', 'native_shop', 'amazon']);
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
