import { describe, expect, it, vi } from 'vitest';

import { shopifyReadinessFailureMessage, testShopifyReadiness } from '../shopifyReadiness';

const credentials = {
  authMode: 'legacy_token' as const,
  shopDomain: 'retail.myshopify.com',
  shopName: 'retail',
  token: 'secret-token',
};

describe('testShopifyReadiness', () => {
  it('verifies the authenticated store identity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      shop: { myshopify_domain: 'retail.myshopify.com' },
    }), { status: 200 }));

    await expect(testShopifyReadiness(credentials, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://retail.myshopify.com/admin/api/2025-10/shop.json',
      expect.objectContaining({
        method: 'GET', headers: expect.objectContaining({ 'X-Shopify-Access-Token': 'secret-token' }),
      }),
    );
  });

  it('rejects unsuccessful responses and mismatched stores', async () => {
    await expect(testShopifyReadiness(credentials, vi.fn().mockResolvedValue(new Response('', { status: 401 })))).rejects.toThrow('HTTP 401');
    await expect(testShopifyReadiness(credentials, vi.fn().mockResolvedValue(new Response(JSON.stringify({
      shop: { myshopify_domain: 'another.myshopify.com' },
    }))))).rejects.toThrow('different store identity');
  });

  it('converts provider failures into bounded safe messages', () => {
    expect(shopifyReadinessFailureMessage(new Error('HTTP 401 with secret details'))).toBe('Shopify rejected the saved credentials.');
    expect(shopifyReadinessFailureMessage(new Error('different store identity'))).toBe('Shopify returned a different store identity.');
    expect(shopifyReadinessFailureMessage(new Error('socket exploded'))).toBe('Shopify could not be reached.');
  });
});