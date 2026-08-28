import { describe, expect, it, vi } from 'vitest';

import { ShopifyService } from '@/services/ShopifyService';

describe('ShopifyService product pagination', () => {
  it('requests active products and returns Shopify cursor parameters', async () => {
    const firstPage = Object.assign([{ id: 1 }, { id: 2 }], {
      nextPageParameters: { limit: 2, page_info: 'opaque-cursor' },
    });
    const list = vi.fn().mockResolvedValue(firstPage);
    const service = new ShopifyService('example.myshopify.com', 'secret');
    (service as any).shopify = { product: { list } };

    await expect(service.getProductsPage({ limit: 2 })).resolves.toEqual({
      products: firstPage,
      nextPageInfo: 'opaque-cursor',
      hasMore: true,
    });
    expect(list).toHaveBeenCalledWith({ limit: 2, status: 'active' });
  });

  it('uses the opaque cursor and stops only when Shopify omits the next cursor', async () => {
    const finalPage = [{ id: 3 }];
    const list = vi.fn().mockResolvedValue(finalPage);
    const service = new ShopifyService('example.myshopify.com', 'secret');
    (service as any).shopify = { product: { list } };

    await expect(service.getProductsPage({ limit: 25, pageInfo: 'opaque-cursor' })).resolves.toEqual({
      products: finalPage,
      nextPageInfo: null,
      hasMore: false,
    });
    expect(list).toHaveBeenCalledWith({ limit: 25, page_info: 'opaque-cursor' });
  });
});