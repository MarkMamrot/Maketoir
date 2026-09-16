import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), credentials: vi.fn(), shopifyUpdate: vi.fn(),
  amazonAccess: vi.fn(), amazonPut: vi.fn(), amazonDelete: vi.fn(), locations: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/onlineShop/onlineShopPages', () => ({ normalizeOnlineShopPageSlug: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
vi.mock('@/lib/shopifyCredentials', () => ({ getShopifyChannelAdminCredentials: mocks.credentials }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class { updateProduct = mocks.shopifyUpdate; } }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.amazonAccess }));
vi.mock('../amazonSpApi', () => ({ putAmazonExistingAsinOffer: mocks.amazonPut, deleteAmazonListingOffer: mocks.amazonDelete }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({ getOnlinePickLocationIds: mocks.locations }));

import {
  publishAmazonExistingAsinOffers,
  publishNativeShopProduct,
  publishShopifyProduct,
} from '../channelProductPublicationAdapters';

describe('channel product publication adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('publishes a ready product to the native storefront', async () => {
    mocks.query.mockResolvedValue([{ name: 'Blue Vase', website_title: null, is_active: 1, retail_variant_count: 1, slug: null }]);
    await expect(publishNativeShopProduct({
      businessId: 'business-1', channelInstanceId: 'native-1', productId: 'ABCDEF12-rest', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'published', externalProductId: 'ABCDEF12-rest' });
    expect(mocks.execute.mock.calls[0][1]).toEqual(['business-1', 'ABCDEF12-rest', 'blue-vase-abcdef12']);
  });

  it('blocks native publication without a sellable variant', async () => {
    mocks.query.mockResolvedValue([{ name: 'Blue Vase', website_title: null, is_active: 1, retail_variant_count: 0, slug: null }]);
    await expect(publishNativeShopProduct({
      businessId: 'business-1', channelInstanceId: 'native-1', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'blocked', issues: ['At least one active variant with a retail price is required.'] });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('updates only an exact-instance Shopify mapping', async () => {
    mocks.query.mockResolvedValue([{ external_product_id: '9988' }]);
    mocks.credentials.mockResolvedValue({ shopDomain: 'sandbox.myshopify.com', token: 'token' });
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'unpublished',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'unpublished', externalProductId: '9988' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'shopify-2', 'product-1']);
    expect(mocks.shopifyUpdate).toHaveBeenCalledWith('9988', { status: 'draft' });
  });

  it('blocks an unmapped Shopify publish but treats an unmapped unpublish as complete', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'blocked', issues: ['Upload or link this product to the exact Shopify storefront first.'] });
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'unpublished',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'unpublished' });
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it('blocks Amazon publication until every offer has safe existing-ASIN inputs', async () => {
    mocks.query.mockResolvedValue([{
      variant_id: 'variant-1', seller_sku: 'SKU-1', asin: null, price_rrp: 20, is_active: 1, is_stock_item: 1,
    }]);
    await expect(publishAmazonExistingAsinOffers({
      businessId: 'business-1', channelInstanceId: 'amazon-1', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'blocked', issues: ['Every mapped Amazon variant requires an ASIN.'] });
    expect(mocks.amazonPut).not.toHaveBeenCalled();
  });

  it('publishes an existing-ASIN Amazon offer with current tax-inclusive price and availability', async () => {
    mocks.query
      .mockResolvedValueOnce([{
        variant_id: 'variant-1', seller_sku: 'SELLER-1', asin: 'B012345678', price_rrp: '44.00', is_active: 1, is_stock_item: 1,
      }])
      .mockResolvedValueOnce([{ available: '7.9' }]);
    mocks.amazonAccess.mockResolvedValue({ accessToken: 'access', sellerId: 'seller-1' });
    mocks.locations.mockResolvedValue([3, 4]);
    await expect(publishAmazonExistingAsinOffers({
      businessId: 'business-1', channelInstanceId: 'amazon-1', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'published', externalProductId: 'B012345678' });
    expect(mocks.amazonPut).toHaveBeenCalledWith('access', 'seller-1', {
      sellerSku: 'SELLER-1', asin: 'B012345678', price: 44, quantity: 7,
    });
  });
});