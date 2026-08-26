import { describe, expect, it } from 'vitest';
import {
  findUniqueUnusedShopifyGiftCard,
  isShopifyGiftCardCodeTakenError,
  type ShopifyGiftCardCandidate,
} from '../giftCardShopifyReconciliation';

const candidate: ShopifyGiftCardCandidate = {
  id: 559355134168,
  last_characters: '1736',
  initial_value: '40.00',
  balance: '40.00',
  currency: 'AUD',
  disabled_at: null,
  expires_on: null,
};

describe('Shopify gift-card reconciliation', () => {
  it('recognises only the duplicate-code response from gift-card creation', () => {
    expect(isShopifyGiftCardCodeTakenError(new Error(
      'Shopify 422 POST /gift_cards.json: {"errors":{"code":["has already been taken"]}}',
    ))).toBe(true);
    expect(isShopifyGiftCardCodeTakenError(new Error('Shopify 422 POST /gift_cards.json: other error'))).toBe(false);
    expect(isShopifyGiftCardCodeTakenError(new Error('Shopify 500 POST /gift_cards.json'))).toBe(false);
  });

  it('returns a unique enabled, unused card with matching identity and value', () => {
    expect(findUniqueUnusedShopifyGiftCard([candidate], '0403831736', 40)).toEqual(candidate);
  });

  it('rejects ambiguous, used, disabled, and value-mismatched candidates', () => {
    expect(findUniqueUnusedShopifyGiftCard([candidate, { ...candidate, id: 2 }], '0403831736', 40)).toBeNull();
    expect(findUniqueUnusedShopifyGiftCard([{ ...candidate, balance: '20.00' }], '0403831736', 40)).toBeNull();
    expect(findUniqueUnusedShopifyGiftCard([{ ...candidate, disabled_at: '2026-08-16T06:20:00Z' }], '0403831736', 40)).toBeNull();
    expect(findUniqueUnusedShopifyGiftCard([{ ...candidate, initial_value: '50.00' }], '0403831736', 40)).toBeNull();
    expect(findUniqueUnusedShopifyGiftCard([{ ...candidate, currency: 'USD' }], '0403831736', 40)).toBeNull();
  });
});