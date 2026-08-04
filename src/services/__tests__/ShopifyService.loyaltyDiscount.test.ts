import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopifyService } from '@/services/ShopifyService';

describe('ShopifyService loyalty discounts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a fixed-value single-use code restricted to the exact Shopify customer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: {
            id: 'gid://shopify/DiscountCodeNode/88',
            codeDiscount: { codes: { nodes: [{ code: 'SOLV-55-ABC' }] } },
          },
          userErrors: [],
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ShopifyService('example.myshopify.com', 'secret').createCustomerDiscountCode({
      code: 'SOLV-55-ABC',
      title: 'Loyalty reward 55',
      amountAud: 10,
      shopifyCustomerId: '12345',
      startsAt: '2026-08-05T00:00:00.000Z',
      endsAt: '2026-11-03T00:00:00.000Z',
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(request.variables.discount).toMatchObject({
      code: 'SOLV-55-ABC',
      customerSelection: { customers: { add: ['gid://shopify/Customer/12345'] } },
      customerGets: { value: { discountAmount: { amount: '10.00', appliesOnEachItem: false } }, items: { all: true } },
      usageLimit: 1,
      appliesOncePerCustomer: true,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    });
    expect(result).toEqual({ id: 'gid://shopify/DiscountCodeNode/88', code: 'SOLV-55-ABC' });
  });
});