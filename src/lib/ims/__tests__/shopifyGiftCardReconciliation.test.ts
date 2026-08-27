import { describe, expect, it } from 'vitest';

import {
  chooseShopifyGiftCardPlaceholder,
  planObservedBalanceUpdate,
  planShopifyGiftCardImport,
} from '../shopifyGiftCardReconciliation';

describe('Shopify gift-card snapshot imports', () => {
  it('normalizes an active Shopify card for local insertion', () => {
    const plan = planShopifyGiftCardImport({
      id: 559460974808,
      last_characters: '7215',
      initial_value: '129.95',
      balance: '129.95',
      currency: 'AUD',
      customer_id: 1234,
      created_at: '2026-08-26T05:02:00Z',
    });

    expect(plan).toMatchObject({
      shopifyGiftCardId: '559460974808',
      preferredCode: 'SHOPIFY:7215',
      fallbackCode: 'SHOPIFY:ID:559460974808',
      initialBalance: 129.95,
      balance: 129.95,
      status: 'active',
      customerId: '1234',
      createdAt: '2026-08-26 05:02:00',
    });
  });

  it('uses the Shopify ID placeholder when another card owns the same last four', () => {
    const plan = planShopifyGiftCardImport({
      id: '559460974808',
      last_characters: '7215',
      balance: '129.95',
    });

    expect(chooseShopifyGiftCardPlaceholder(plan, '111111111111')).toBe('SHOPIFY:ID:559460974808');
  });

  it('keeps the preferred placeholder when unused or owned by the same Shopify card', () => {
    const plan = planShopifyGiftCardImport({ id: 559460974808, last_characters: '7215', balance: 10 });

    expect(chooseShopifyGiftCardPlaceholder(plan, null)).toBe('SHOPIFY:7215');
    expect(chooseShopifyGiftCardPlaceholder(plan, 559460974808)).toBe('SHOPIFY:7215');
  });

  it('maps disabled cards without value to redeemed and retained value to cancelled', () => {
    expect(planShopifyGiftCardImport({ id: 1, balance: 0, disabled_at: '2026-08-27' }).status).toBe('redeemed');
    expect(planShopifyGiftCardImport({ id: 2, balance: 5, disabled_at: '2026-08-27' }).status).toBe('cancelled');
  });

  it('applies a provider balance only when unseen events explain the checkpoint delta', () => {
    expect(planObservedBalanceUpdate({
      localBalance: 100,
      previousProviderBalance: 100,
      currentProviderBalance: 70,
      unseenTransactionAmounts: [-20, -10],
    })).toEqual({ applyProviderBalance: true, state: 'matched', reason: null });
  });

  it('keeps unexplained or locally divergent balances in review', () => {
    expect(planObservedBalanceUpdate({
      localBalance: 95,
      previousProviderBalance: 100,
      currentProviderBalance: 70,
      unseenTransactionAmounts: [-30],
    })).toMatchObject({ applyProviderBalance: false, state: 'review_required' });
  });
});