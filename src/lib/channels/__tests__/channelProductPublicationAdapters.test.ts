import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), operationContext: vi.fn(), shopifyUpdate: vi.fn(), shopifyCreate: vi.fn(),
  shopifyCreateImage: vi.fn(), productGet: vi.fn(), imageList: vi.fn(), imageUpdate: vi.fn(), inventoryPush: vi.fn(),
  amazonAccess: vi.fn(), amazonPut: vi.fn(), amazonDelete: vi.fn(), locations: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/onlineShop/onlineShopPages', () => ({ normalizeOnlineShopPageSlug: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.operationContext }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {
  updateProduct = mocks.shopifyUpdate;
  createProduct = mocks.shopifyCreate;
  createProductImage = mocks.shopifyCreateImage;
} }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsProductsRepo: { get: mocks.productGet },
  ImsImagesRepo: { list: mocks.imageList, updateUrl: mocks.imageUpdate },
}));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.amazonAccess }));
vi.mock('../amazonSpApi', () => ({ putAmazonExistingAsinOffer: mocks.amazonPut, deleteAmazonListingOffer: mocks.amazonDelete }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({
  getOnlinePickLocationIds: mocks.locations,
  pushInventoryForShopifyInstance: mocks.inventoryPush,
  shopifyInventoryPolicyPayload: () => ({ inventory_management: 'shopify' }),
  shopifyVariantPricePayload: (price: unknown) => ({ price: String(price) }),
}));

import {
  publishAmazonExistingAsinOffers,
  publishNativeShopProduct,
  publishShopifyProduct,
} from '../channelProductPublicationAdapters';

describe('channel product publication adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.imageList.mockResolvedValue([]);
    mocks.inventoryPush.mockResolvedValue({ pushed: 1, skipped: 0, errors: [], locationId: 1 });
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
    mocks.query
      .mockResolvedValueOnce([{ external_product_id: '9988', readiness_status: 'ready' }])
      .mockResolvedValueOnce([{ external_product_id: '9988', variant_id: 'variant-1' }]);
    mocks.operationContext.mockResolvedValue({ credentials: { shopDomain: 'sandbox.myshopify.com', token: 'token' } });
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'published', externalProductId: '9988' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'shopify-2', 'product-1']);
    expect(mocks.operationContext).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'shopify-2' });
    expect(mocks.inventoryPush).toHaveBeenCalledWith(expect.objectContaining({
      channelInstanceId: 'shopify-2', variantIds: ['variant-1'], force: true,
    }));
    expect(mocks.shopifyUpdate).toHaveBeenCalledWith('9988', { status: 'active' });
  });

  it('creates and exactly maps an unmapped Shopify product before publishing it', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.productGet.mockResolvedValue({
      product_id: 'product-1', name: 'Blue Vase', website_title: 'Blue Vase', description: 'Glazed vase',
      brand: 'Example', product_type: 'Homewares', tags: 'blue', is_active: 1, is_stock_item: 1,
      variants: [{ variant_id: 'variant-1', is_active: 1, sku: 'BLUE-1', barcode: null, price_rrp: 29.95,
        price_rrp_sale: null, weight_kg: 0.5, option1_name: null, option1_value: null }],
    });
    mocks.operationContext.mockResolvedValue({ credentials: { shopDomain: 'sandbox.myshopify.com', token: 'token' } });
    mocks.shopifyCreate.mockResolvedValue({ id: 9988, variants: [{ id: 7766, inventory_item_id: 5544 }] });
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'published',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'published', externalProductId: '9988' });
    expect(mocks.query.mock.calls[1]?.[0]).toContain('BINARY variant.variant_id = BINARY mapping.variant_id');
    expect(mocks.shopifyCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('ims_sales_channel_product_mappings'),
      expect.arrayContaining(['business-1', 'shopify-2', 'variant-1', '9988', '7766', '5544']));
    expect(mocks.inventoryPush).toHaveBeenCalledWith(expect.objectContaining({ channelInstanceId: 'shopify-2' }));
    expect(mocks.shopifyUpdate).toHaveBeenCalledWith('9988', { status: 'active' });
  });

  it('treats an unmapped Shopify unpublish as complete without provider mutation', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(publishShopifyProduct({
      businessId: 'business-1', channelInstanceId: 'shopify-2', productId: 'product-1', desiredState: 'unpublished',
    })).resolves.toEqual({ outcome: 'applied', providerState: 'unpublished' });
    expect(mocks.operationContext).not.toHaveBeenCalled();
  });

  it('uses a ready product-level Shopify ID when no variant mapping exists', async () => {
    mocks.query
      .mockResolvedValueOnce([{ external_product_id: '7766', readiness_status: 'ready' }])
      .mockResolvedValueOnce([]);
    mocks.operationContext.mockResolvedValue({ credentials: { shopDomain: 'sandbox.myshopify.com', token: 'token' } });
    await expect(publishShopifyProduct({ businessId: 'business-1', channelInstanceId: 'shopify-2',
      productId: 'product-1', desiredState: 'published' }))
      .resolves.toEqual({ outcome: 'applied', providerState: 'published', externalProductId: '7766' });
    expect(mocks.shopifyUpdate).toHaveBeenCalledWith('7766', { status: 'active' });
  });

  it('never changes Shopify status for a blocked duplicate-ID assignment', async () => {
    mocks.query.mockResolvedValueOnce([{ external_product_id: '7766', readiness_status: 'blocked' }]);
    await expect(publishShopifyProduct({ businessId: 'business-1', channelInstanceId: 'shopify-2',
      productId: 'product-1', desiredState: 'unpublished' }))
      .resolves.toEqual({ outcome: 'blocked', issues: ['Resolve this product publication blocker before changing Shopify status.'] });
    expect(mocks.shopifyUpdate).not.toHaveBeenCalled();
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