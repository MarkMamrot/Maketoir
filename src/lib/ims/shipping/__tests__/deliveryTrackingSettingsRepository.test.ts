import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DELIVERY_TRACKING_CHANNELS } from '../deliveryTrackingSettings';

const mocks = vi.hoisted(() => ({ run: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
import { DELIVERY_TRACKING_CHANNELS_KEY, getDeliveryTrackingChannels, saveDeliveryTrackingChannels } from '../deliveryTrackingSettingsRepository';

let tenant: string | null;
let saved: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); tenant = null; saved = new Map();
  mocks.run.mockImplementation(async (businessId: string, callback: () => Promise<unknown>) => {
    const previous = tenant; tenant = businessId;
    try { return await callback(); } finally { tenant = previous; }
  });
  mocks.query.mockImplementation(async (sql: string, params: string[]) => {
    expect(tenant).toBe(params[0]); expect(sql).toContain('WHERE business_id = ?');
    expect(params[1]).toBe(DELIVERY_TRACKING_CHANNELS_KEY);
    return saved.has(params[0]) ? [{ value: saved.get(params[0]) }] : [];
  });
  mocks.execute.mockImplementation(async (_sql: string, params: string[]) => {
    expect(tenant).toBe(params[0]); expect(params[1]).toBe(DELIVERY_TRACKING_CHANNELS_KEY);
    saved.set(params[0], params[2]);
    return { affectedRows: 1 };
  });
});

describe('tenant-owned delivery tracking preferences', () => {
  it('uses Amazon-only defaults without writes or lazy schema changes', async () => {
    const defaults = await getDeliveryTrackingChannels('tenant-a');
    expect(defaults).toEqual(DEFAULT_DELIVERY_TRACKING_CHANNELS);
    defaults.amazon = false;
    expect(await getDeliveryTrackingChannels('tenant-a')).toEqual(DEFAULT_DELIVERY_TRACKING_CHANNELS);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('saves all switches atomically and reloads them without affecting other tenants', async () => {
    const channels = { amazon: false, shopify: true, native_shop: true };
    await saveDeliveryTrackingChannels('tenant-a', channels);
    expect(await getDeliveryTrackingChannels('tenant-a')).toEqual(channels);
    expect(await getDeliveryTrackingChannels('tenant-b')).toEqual(DEFAULT_DELIVERY_TRACKING_CHANNELS);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), [
      'tenant-a', DELIVERY_TRACKING_CHANNELS_KEY, JSON.stringify(channels),
    ]);
    expect(tenant).toBeNull();
  });
  it.each(['not-json PRIVATE', '{"amazon":true}', '{"amazon":1,"shopify":false,"native_shop":false}'])('fails closed for invalid saved settings', async value => {
    saved.set('tenant-a', value);
    await expect(getDeliveryTrackingChannels('tenant-a')).rejects.toThrow('Saved delivery tracking settings are invalid');
    try { await getDeliveryTrackingChannels('tenant-a'); } catch (error) {
      expect(String(error)).not.toContain('PRIVATE');
    }
  });
  it('rejects conflicting saved rows and read failures rather than using defaults', async () => {
    mocks.query.mockResolvedValueOnce([{ value: '{}' }, { value: '{}' }]);
    await expect(getDeliveryTrackingChannels('tenant-a')).rejects.toThrow('conflicting');
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getDeliveryTrackingChannels('tenant-a')).rejects.toThrow('database unavailable');
  });
  it('validates scope and input before writing', async () => {
    await expect(saveDeliveryTrackingChannels('', { ...DEFAULT_DELIVERY_TRACKING_CHANNELS })).rejects.toThrow('business scope');
    await expect(getDeliveryTrackingChannels('')).rejects.toThrow('business scope');
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
});
