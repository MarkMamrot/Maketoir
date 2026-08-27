import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopifyAdminUserError, ShopifyService } from '@/services/ShopifyService';

describe('ShopifyService gift-card transactions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paginates and normalizes transaction history', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { giftCard: {
        balance: { amount: '90.00', currencyCode: 'AUD' }, updatedAt: '2026-08-27T01:00:00Z',
        enabled: true, deactivatedAt: null,
        transactions: {
          nodes: [{ id: 'credit-1', __typename: 'GiftCardCreditTransaction', amount: { amount: '100.00', currencyCode: 'AUD' }, processedAt: '2026-08-26T01:00:00Z', note: 'Issued' }],
          pageInfo: { hasNextPage: true, endCursor: 'next-page' },
        },
      } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { giftCard: {
        balance: { amount: '90.00', currencyCode: 'AUD' }, updatedAt: '2026-08-27T01:00:00Z',
        enabled: true, deactivatedAt: null,
        transactions: {
          nodes: [{ id: 'debit-1', __typename: 'GiftCardDebitTransaction', amount: { amount: '-10.00', currencyCode: 'AUD' }, processedAt: '2026-08-27T01:00:00Z', note: 'Used' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ShopifyService('example.myshopify.com', 'secret').getGiftCardTransactions(123);

    expect(result.balance).toBe(90);
    expect(result.transactions.map(transaction => transaction.type)).toEqual(['credit', 'debit']);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(secondRequest.variables).toEqual({ id: 'gid://shopify/GiftCard/123', after: 'next-page' });
  });

  it('creates a debit with the documented input and returns its provider identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { giftCardDebit: {
      giftCardDebitTransaction: {
        id: 'gid://shopify/GiftCardDebitTransaction/44',
        amount: { amount: '-10.00', currencyCode: 'AUD' },
        processedAt: '2026-08-27T02:00:00Z', note: 'POS redemption',
        giftCard: { balance: { amount: '25.00', currencyCode: 'AUD' } },
      },
      userErrors: [],
    } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ShopifyService('example.myshopify.com', 'secret').giftCardDebit({
      giftCardId: 123, amount: 10, note: 'POS redemption',
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(request.variables).toEqual({
      id: 'gid://shopify/GiftCard/123',
      input: { debitAmount: { amount: '10.00', currencyCode: 'AUD' }, note: 'POS redemption' },
    });
    expect(request.query).toContain('giftCardDebit(id: $id, debitInput: $input)');
    expect(result).toMatchObject({ transactionId: 'gid://shopify/GiftCardDebitTransaction/44', balance: 25 });
  });

  it('surfaces Shopify transaction user errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { giftCardCredit: {
      giftCardCreditTransaction: null,
      userErrors: [{ field: ['creditInput'], message: 'Missing scope', code: 'ACCESS_DENIED' }],
    } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(new ShopifyService('example.myshopify.com', 'secret').giftCardCredit({
      giftCardId: 123, amount: 5,
    })).rejects.toBeInstanceOf(ShopifyAdminUserError);
  });
});