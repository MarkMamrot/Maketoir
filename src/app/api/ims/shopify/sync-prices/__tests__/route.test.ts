import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), disabled: vi.fn(), query: vi.fn(), context: vi.fn(), bulkUpdate: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.disabled }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {
  constructor(readonly domain: string) {}
  bulkUpdateVariantPrices(productId: string, variants: unknown[]) {
    return mocks.bulkUpdate(this.domain, productId, variants);
  }
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsShopifyRepo: { logAction: vi.fn() } }));

import { GET, POST } from '../route';

describe('exact-instance Shopify price sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.disabled.mockResolvedValue(null);
    mocks.context.mockResolvedValue({ credentials: { shopDomain: 'store-b.myshopify.com', token: 'secret' } });
    mocks.bulkUpdate.mockResolvedValue({ userErrors: [] });
    mocks.report.mockResolvedValue(undefined);
  });

  it('rejects ambiguous requests without a channel instance', async () => {
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-prices', {
      method: 'POST', body: JSON.stringify({ product_ids: ['product-1'] }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('uses only the selected instance and its canonical mappings', async () => {
    mocks.query.mockResolvedValue([{
      variant_id: 'variant-1', shopify_variant_id: 'external-variant-b',
      price_rrp: 25, price_rrp_sale: 20, shopify_product_id: 'external-product-b',
    }]);
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-prices', {
      method: 'POST',
      body: JSON.stringify({ channelInstanceId: 'store-b', product_ids: ['product-1'] }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith({ businessId: 'biz-1', channelInstanceId: 'store-b' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['biz-1', 'store-b', 'product-1']);
    expect(mocks.bulkUpdate).toHaveBeenCalledWith(
      'store-b.myshopify.com', 'external-product-b',
      [{ shopify_variant_id: 'external-variant-b', price: '20.00', compare_at_price: '25.00' }],
    );
  });

  it('requires an exact instance when listing mapped products', async () => {
    const response = await GET(new Request('http://localhost/api/ims/shopify/sync-prices'));
    expect(response.status).toBe(400);
  });
});