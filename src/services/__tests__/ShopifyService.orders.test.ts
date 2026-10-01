import { describe, expect, it, vi } from 'vitest';

import { ShopifyService } from '@/services/ShopifyService';

describe('ShopifyService updated order pagination', () => {
  it('loads the complete bounded update window using Shopify cursor parameters', async () => {
    const firstPage = Object.assign([
      { id: 101, updated_at: '2026-10-01T00:00:00Z', fulfillment_status: 'fulfilled' },
    ], { nextPageParameters: { limit: 250, page_info: 'next-page' } });
    const finalPage = [{ id: 102, updated_at: '2026-10-01T01:00:00Z', fulfillment_status: null }];
    const list = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(finalPage);
    const service = new ShopifyService('example.myshopify.com', 'secret');
    (service as any).shopify = { order: { list } };

    await expect(service.getOrdersUpdatedSince('2026-09-30T12:34:56Z')).resolves.toEqual([
      firstPage[0], finalPage[0],
    ]);
    expect(list).toHaveBeenNthCalledWith(1, {
      limit: 250,
      status: 'any',
      updated_at_min: '2026-09-30T12:34:56.000Z',
      fields: 'id,created_at,updated_at,fulfillment_status',
    });
    expect(list).toHaveBeenNthCalledWith(2, { limit: 250, page_info: 'next-page' });
  });

  it('rejects an invalid update timestamp before calling Shopify', async () => {
    const list = vi.fn();
    const service = new ShopifyService('example.myshopify.com', 'secret');
    (service as any).shopify = { order: { list } };

    await expect(service.getOrdersUpdatedSince('not-a-date')).rejects.toThrow('valid Shopify order update timestamp');
    expect(list).not.toHaveBeenCalled();
  });
});