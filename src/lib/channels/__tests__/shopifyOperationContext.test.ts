import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertShopifyEnabled: vi.fn(),
  getForBusiness: vi.fn(),
  getShopifyChannelAdminCredentials: vi.fn(),
}));

vi.mock('@/lib/ims/businessOperations', () => ({ assertShopifyEnabled: mocks.assertShopifyEnabled }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { getForBusiness: mocks.getForBusiness },
}));
vi.mock('@/lib/shopifyCredentials', () => ({
  getShopifyChannelAdminCredentials: mocks.getShopifyChannelAdminCredentials,
}));

import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';

const instance = {
  channelInstanceId: 'instance-1', businessId: 'business-1', provider: 'shopify' as const,
  displayName: 'Retail Shopify', externalAccountKey: 'retail.myshopify.com', enabled: true,
  runtimeStatus: 'active' as const, readinessStatus: 'ready' as const, settings: {},
  lastSyncAt: null, safeError: null,
};

describe('getShopifyOperationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertShopifyEnabled.mockResolvedValue(undefined);
    mocks.getForBusiness.mockResolvedValue(instance);
    mocks.getShopifyChannelAdminCredentials.mockResolvedValue({
      authMode: 'legacy_token', shopDomain: 'retail.myshopify.com', shopName: 'retail', token: 'token',
    });
  });

  it('returns credentials only after validating the exact active ready instance', async () => {
    const result = await getShopifyOperationContext({ businessId: ' business-1 ', channelInstanceId: ' instance-1 ' });

    expect(result).toMatchObject({ businessId: 'business-1', channelInstanceId: 'instance-1', instance });
    expect(mocks.assertShopifyEnabled).toHaveBeenCalledWith('business-1');
    expect(mocks.getForBusiness).toHaveBeenCalledWith('business-1', 'instance-1');
    expect(mocks.getShopifyChannelAdminCredentials).toHaveBeenCalledWith('business-1', 'instance-1');
  });

  it('rejects a missing or non-Shopify instance before loading credentials', async () => {
    mocks.getForBusiness.mockResolvedValue({ ...instance, provider: 'amazon' });

    await expect(getShopifyOperationContext({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .rejects.toMatchObject({ code: 'instance_not_found' });
    expect(mocks.getShopifyChannelAdminCredentials).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false }, 'instance_inactive'],
    [{ runtimeStatus: 'paused' }, 'instance_inactive'],
    [{ readinessStatus: 'not_tested' }, 'instance_not_ready'],
  ])('rejects an unavailable instance %#', async (override, code) => {
    mocks.getForBusiness.mockResolvedValue({ ...instance, ...override });

    await expect(getShopifyOperationContext({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .rejects.toMatchObject({ code });
    expect(mocks.getShopifyChannelAdminCredentials).not.toHaveBeenCalled();
  });

  it('rejects an instance without exact credentials', async () => {
    mocks.getShopifyChannelAdminCredentials.mockResolvedValue(null);

    await expect(getShopifyOperationContext({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .rejects.toMatchObject({ code: 'credentials_missing' });
  });
});