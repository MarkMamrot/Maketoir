import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), product: vi.fn(), images: vi.fn(), context: vi.fn(), query: vi.fn(),
  updateProduct: vi.fn(), getProduct: vi.fn(), syncSkus: vi.fn(),
  inventory: vi.fn(), log: vi.fn(), report: vi.fn(), createProduct: vi.fn(), linkProduct: vi.fn(), linkVariant: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: vi.fn(), imsQuery: mocks.query }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {
  updateProduct = mocks.updateProduct;
  getProduct = mocks.getProduct;
  syncVariantSkus = mocks.syncSkus;
  createProduct = mocks.createProduct;
} }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: vi.fn() }));
vi.mock('@/lib/channels/shopifyProductOperationContext', () => ({
  getShopifyProductOperationContext: mocks.context,
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsProductsRepo: { get: mocks.product }, ImsImagesRepo: { list: mocks.images },
  ImsShopifyRepo: { logAction: mocks.log, linkProduct: mocks.linkProduct, linkVariant: mocks.linkVariant },
}));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({
  shopifyInventoryPolicyPayload: () => ({ inventory_management: 'shopify' }),
  shopifyVariantPricePayload: () => ({ price: '12.00', compare_at_price: null }),
  pushInventoryForShopifyInstance: mocks.inventory,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

describe('Shopify product resync SKU handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.product.mockResolvedValue({
      name: 'Vase', variants: [{ variant_id: 'v1', sku: 'LOCAL', shopify_variant_id: 'legacy-id', price_rrp: 12 }],
    });
    mocks.images.mockResolvedValue([]);
    mocks.context.mockResolvedValue({
      channelInstanceId: 'store-2', externalProductId: '11',
      credentials: { shopName: 'example', shopDomain: 'example.myshopify.com', token: 'secret' },
    });
    mocks.query.mockResolvedValue([{ external_variant_id: '22', sku: '00123' }]);
    mocks.getProduct.mockResolvedValue({ images: [] });
    mocks.log.mockResolvedValue(undefined);
    mocks.inventory.mockResolvedValue({ pushed: 1, errors: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());
  const request = () => new Request('http://localhost/api/ims/products/p1/shopify-sync', {
    method: 'POST', body: JSON.stringify({ channelInstanceId: 'store-2' }),
  });

  it('uses exact storefront mappings for SKU writes rather than legacy variant IDs', async () => {
    const result = await POST(request(), { params: { id: 'p1' } });
    expect(result.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("mapping.mapping_status = 'linked'"),
      ['biz-1', 'store-2', '11', 'p1']);
    expect(mocks.syncSkus).toHaveBeenCalledWith('11', [{ id: '22', sku: '00123' }]);
    const variantUpdate = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(variantUpdate.variant).not.toHaveProperty('sku');
  });

  it('does not send a blank local SKU to clear a Shopify SKU', async () => {
    mocks.query.mockResolvedValue([{ external_variant_id: '22', sku: '  ' }]);
    expect((await POST(request(), { params: { id: 'p1' } })).status).toBe(200);
    expect(mocks.syncSkus).toHaveBeenCalledWith('11', []);
  });

  it.each([
    { option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour', option2_value: 'Default' },
    { option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour', option2_value: null },
  ])('does not create visible options for an internal default row: %j', async options => {
    mocks.context.mockResolvedValue({
      channelInstanceId: 'store-2', externalProductId: null,
      credentials: { shopName: 'example', shopDomain: 'example.myshopify.com', token: 'secret' },
    });
    mocks.product.mockResolvedValue({
      name: 'Purse', variants: [{ variant_id: 'v1', sku: 'SS261464-ONS', price_rrp: 59, ...options }],
    });
    mocks.createProduct.mockResolvedValue({ id: 11, variants: [{ id: 22, inventory_item_id: 33 }] });
    const result = await POST(request(), { params: { id: 'p1' } });
    expect(result.status).toBe(200);
    expect(mocks.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      options: undefined, variants: [expect.objectContaining({ sku: 'SS261464-ONS', option1: 'Default Title' })],
    }));
    expect(mocks.createProduct.mock.calls[0][0].variants[0]).not.toHaveProperty('option2');
    expect(mocks.linkVariant).toHaveBeenCalledWith('v1', '11', '22', '33', 'biz-1', 'store-2');
    expect(mocks.syncSkus).toHaveBeenCalledWith('11', [{ id: '22', sku: 'SS261464-ONS' }]);
  });

  it('returns and persists a runtime failure when Shopify does not save the SKU', async () => {
    mocks.syncSkus.mockRejectedValue(new Error('Shopify did not persist SKU for variant 22.'));
    const result = await POST(request(), { params: { id: 'p1' } });
    expect(result.status).toBe(500);
    expect(await result.json()).toHaveProperty('error', 'Shopify did not persist SKU for variant 22.');
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'product_sync', reference: { type: 'product', id: 'p1' },
    }));
    expect(mocks.log).toHaveBeenCalledWith('resync', 'error', expect.any(String), 'biz-1',
      { product_id: 'p1' }, 'store-2');
  });
});
