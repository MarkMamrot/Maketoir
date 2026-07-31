import { describe, expect, it, vi } from 'vitest';

import {
  GiftCardVoidBlockedError,
  unwindGiftCardTransactionsForSale,
  type GiftCardVoidConnection,
} from '../giftCardSaleVoid';

function connectionWith(responses: any[][]) {
  const execute = vi.fn(async () => [responses.shift() ?? [], {}]);
  return { execute } as unknown as GiftCardVoidConnection & { execute: ReturnType<typeof vi.fn> };
}

describe('unwindGiftCardTransactionsForSale', () => {
  it('restores a partial redemption exactly once', async () => {
    const connection = connectionWith([
      [{ id: 10, card_id: 5, type: 'redeem', amount: '-4.00', created_at: '2026-07-31' }],
      [{ id: 5, balance: '6.00', shopify_gc_id: null }],
      [],
      [],
      [],
    ]);

    const result = await unwindGiftCardTransactionsForSale(connection, 100);

    expect(result).toEqual([{ transactionId: 10, cardId: 5, kind: 'redemption', amount: 4 }]);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'return', ?, ?, ?, ?, ?)"),
      [5, 4, 10, 100, 'void:gift-card-tx:10', expect.stringContaining('reverses gift card transaction 10')],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      [10, 5],
    );
  });

  it('cancels an unused locally-issued card', async () => {
    const connection = connectionWith([
      [{ id: 20, card_id: 6, type: 'issue', amount: '25.00', created_at: '2026-07-31' }],
      [{ id: 6, balance: '25.00', shopify_gc_id: null }],
      [],
      [],
      [],
      [],
    ]);

    await unwindGiftCardTransactionsForSale(connection, 101);

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'adjust', ?, 0, ?, ?, ?)"),
      [6, -25, 101, 'void:gift-card-tx:20', expect.stringContaining('cancels gift card transaction 20')],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      [6],
    );
  });

  it('blocks an issuing-sale void while a later redemption remains', async () => {
    const connection = connectionWith([
      [{ id: 20, card_id: 6, type: 'issue', amount: '25.00', created_at: '2026-07-31' }],
      [{ id: 6, balance: '15.00', shopify_gc_id: null }],
      [],
      [{ id: 21, type: 'redeem', idempotency_key: null }],
    ]);

    await expect(unwindGiftCardTransactionsForSale(connection, 101)).rejects.toBeInstanceOf(GiftCardVoidBlockedError);
  });

  it('blocks Shopify-linked cards before writing', async () => {
    const connection = connectionWith([
      [{ id: 10, card_id: 5, type: 'redeem', amount: '-4.00', created_at: '2026-07-31' }],
      [{ id: 5, balance: '6.00', shopify_gc_id: '123' }],
    ]);

    await expect(unwindGiftCardTransactionsForSale(connection, 100)).rejects.toThrow('Shopify-linked');
    expect(connection.execute).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate an existing reversal', async () => {
    const connection = connectionWith([
      [{ id: 10, card_id: 5, type: 'redeem', amount: '-4.00', created_at: '2026-07-31' }],
      [{ id: 5, balance: '10.00', shopify_gc_id: null }],
      [{ id: 30 }],
    ]);

    await expect(unwindGiftCardTransactionsForSale(connection, 100)).resolves.toEqual([]);
    expect(connection.execute).toHaveBeenCalledTimes(3);
  });

  it('reverses same-sale redemption before checking its earlier issuance', async () => {
    const connection = connectionWith([
      [
        { id: 20, card_id: 6, type: 'issue', amount: '25.00', created_at: '2026-07-31' },
        { id: 21, card_id: 6, type: 'redeem', amount: '-10.00', created_at: '2026-07-31' },
      ],
      [{ id: 6, balance: '15.00', shopify_gc_id: null }],
      [],
      [],
      [],
      [],
      [
        { id: 21, type: 'redeem', idempotency_key: null },
        { id: 22, type: 'return', idempotency_key: 'void:gift-card-tx:21' },
      ],
      [],
      [],
    ]);

    await expect(unwindGiftCardTransactionsForSale(connection, 101)).resolves.toEqual([
      { transactionId: 21, cardId: 6, kind: 'redemption', amount: 10 },
    ]);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      [6],
    );
  });
});