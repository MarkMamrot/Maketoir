import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertShopifyEnabled: mocks.enabled,
  isOnlineChannelDisabledError: () => false,
}));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { getForBusiness: mocks.get, setShopifySettingsForBusiness: mocks.save },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH } from '../route';

const context = { params: { id: 'store-1' } };
const instance = {
  provider: 'shopify',
  settings: { shopify: {
    orders: { enabled: true, syncFrom: '2026-09-01', locationId: 7 },
    inventory: { enabled: true, buffer: 2, intervalMinutes: 15, pickLocationIds: [7] },
  } },
};

describe('/api/ims/channels/[id]/shopify/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.get.mockResolvedValue(instance);
    mocks.save.mockResolvedValue(instance);
  });

  it('loads settings from the exact business-owned Shopify instance', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith('business-1', 'store-1');
    expect((await response.json()).settings.inventory.buffer).toBe(2);
  });

  it('merges a partial update without resetting untouched groups', async () => {
    const response = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ settings: { inventory: { buffer: 5 } } }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      channelInstanceId: 'store-1',
      settings: expect.objectContaining({
        orders: expect.objectContaining({ enabled: true, locationId: 7 }),
        inventory: expect.objectContaining({ enabled: true, buffer: 5 }),
      }),
    }));
  });

  it('rejects non-admin writes and invalid settings', async () => {
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', tier: 'Staff' });
    const forbidden = await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{}' }), context);
    expect(forbidden.status).toBe(403);

    const invalid = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ settings: { inventory: { intervalMinutes: 0 } } }),
    }), context);
    expect(invalid.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('does not expose another business or provider', async () => {
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce({ provider: 'amazon', settings: {} });
    expect((await GET(new Request('http://localhost'), context)).status).toBe(404);
    expect((await GET(new Request('http://localhost'), context)).status).toBe(404);
  });
});