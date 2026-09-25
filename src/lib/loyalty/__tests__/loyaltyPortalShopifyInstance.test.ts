import { beforeEach, describe, expect, it, vi } from 'vitest';

const listForBusiness = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness },
}));

import { resolveLoyaltyPortalShopifyInstance } from '@/lib/loyalty/loyaltyPortalShopifyInstance';

const instance = (channelInstanceId: string, externalAccountKey = 'shop.example.com') => ({
  channelInstanceId,
  provider: 'shopify',
  enabled: true,
  runtimeStatus: 'active',
  readinessStatus: 'ready',
  externalAccountKey,
});

describe('resolveLoyaltyPortalShopifyInstance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the one active instance bound to the profile return host', async () => {
    listForBusiness.mockResolvedValue([instance('instance-1'), instance('instance-2', 'other.example.com')]);
    await expect(resolveLoyaltyPortalShopifyInstance({
      businessId: 'business-1',
      shopifyReturnUrl: 'https://shop.example.com/account',
    })).resolves.toBe('instance-1');
  });

  it('fails closed when profile binding is ambiguous', async () => {
    listForBusiness.mockResolvedValue([instance('instance-1'), instance('instance-2')]);
    await expect(resolveLoyaltyPortalShopifyInstance({
      businessId: 'business-1',
      shopifyReturnUrl: 'https://shop.example.com/account',
    })).resolves.toBeNull();
  });

  it('requires the profile-bound instance to be among the customer mappings', async () => {
    listForBusiness.mockResolvedValue([instance('instance-1')]);
    await expect(resolveLoyaltyPortalShopifyInstance({
      businessId: 'business-1',
      shopifyReturnUrl: 'https://shop.example.com/account',
      allowedChannelInstanceIds: ['instance-2'],
    })).resolves.toBeNull();
  });
});