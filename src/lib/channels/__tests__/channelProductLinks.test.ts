import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), profile: vi.fn(), credentials: vi.fn(), getProduct: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/onlineShop/onlineShopProfile', () => ({ OnlineShopProfileRepository: { getByBusinessId: mocks.profile } }));
vi.mock('@/lib/shopifyCredentials', () => ({ getShopifyChannelAdminCredentials: mocks.credentials }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class { getProduct = mocks.getProduct; } }));

import { getChannelProductLinks } from '../channelProductLinks';

function instance(provider: 'shopify' | 'native_shop' | 'amazon') {
  return { channelInstanceId: 'channel-1', businessId: 'business-1', provider, displayName: 'Store',
    externalAccountKey: 'account', enabled: true, runtimeStatus: 'active' as const, readinessStatus: 'ready' as const,
    settings: {}, lastSyncAt: null, safeError: null };
}

describe('channel product links', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('builds exact-instance Shopify links from mapping and credentials', async () => {
    mocks.query.mockResolvedValue([{ external_product_id: '123' }]);
    mocks.credentials.mockResolvedValue({ shopDomain: 'example.myshopify.com', shopName: 'example', token: 'secret' });
    mocks.getProduct.mockResolvedValue({ handle: 'summer-dress' });
    await expect(getChannelProductLinks({ businessId: 'business-1', productId: 'product-1', instance: instance('shopify') }))
      .resolves.toEqual({ storefrontUrl: 'https://example.myshopify.com/products/summer-dress',
        adminUrl: 'https://admin.shopify.com/store/example/products/123' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'channel-1', 'product-1']);
  });

  it('builds an Amazon product link only from an exact-instance ASIN mapping', async () => {
    mocks.query.mockResolvedValue([{ external_product_id: 'B012345678' }]);
    await expect(getChannelProductLinks({ businessId: 'business-1', productId: 'product-1', instance: instance('amazon') }))
      .resolves.toEqual({ storefrontUrl: 'https://www.amazon.com.au/dp/B012345678', adminUrl: null });
  });

  it('builds native storefront and management links from the saved publication slug', async () => {
    mocks.profile.mockResolvedValue({ slug: 'monsterthreads' });
    mocks.query.mockResolvedValue([{ slug: 'summer-dress-product' }]);
    await expect(getChannelProductLinks({ businessId: 'business-1', productId: 'product-1', instance: instance('native_shop') }))
      .resolves.toEqual({ storefrontUrl: '/shop/monsterthreads/products/summer-dress-product', adminUrl: '/ims#online-shop' });
  });
});