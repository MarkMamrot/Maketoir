import { describe, expect, it } from 'vitest';

import {
  calculateEarnedPoints,
  calculateEligibleSpendCents,
  calculatePosEligibleSpend,
  calculatePosReturnEligibleCents,
  calculateShopifyEligibleSpend,
  calculateShopifyRefundEligibleSpend,
  calculateProportionalReturnReversal,
  calculateReversalPoints,
  canClaimReward,
  parseLoyaltySettings,
} from '@/lib/loyalty/calculations';

describe('loyalty calculations', () => {
  it('floors points once from tax-inclusive eligible spend', () => {
    expect(calculateEarnedPoints({ merchandiseTotal: 39.99, earnRate: 1 })).toBe(39);
    expect(calculateEarnedPoints({ merchandiseTotal: 39.99, earnRate: 1.5 })).toBe(59);
  });

  it('excludes discounts, gift card products, and loyalty-funded value', () => {
    const input = {
      merchandiseTotal: 150,
      discountTotal: 10,
      giftCardProductTotal: 25,
      loyaltyDiscountTotal: 5,
    };
    expect(calculateEligibleSpendCents(input)).toBe(11000);
    expect(calculateEarnedPoints({ ...input, earnRate: 1 })).toBe(110);
  });

  it('excludes gift-card products and allocates order discounts proportionally', () => {
    expect(calculatePosEligibleSpend({
      items: [
        { lineTotal: 80, discountAmount: 20 },
        { lineTotal: 50, isGiftCard: true },
      ],
      discountTotal: 33,
    })).toBe(72);
  });

  it('does not reduce earning when a gift card is only used as payment', () => {
    expect(calculatePosEligibleSpend({
      items: [{ lineTotal: 100 }],
      discountTotal: 0,
    })).toBe(100);
  });

  it('excludes only the net discounted value of Shopify gift-card products', () => {
    expect(calculateShopifyEligibleSpend({
      subtotalPrice: 135,
      lineItems: [
        { quantity: 1, price: '100.00', giftCard: false, discountAllocations: [{ amount: '10.00' }] },
        { quantity: 1, price: '50.00', giftCard: true, discountAllocations: [{ amount: '5.00' }] },
      ],
    })).toBe(90);
  });

  it('never produces negative Shopify eligible spend', () => {
    expect(calculateShopifyEligibleSpend({
      subtotalPrice: 20,
      lineItems: [{ quantity: 1, price: 50, giftCard: true }],
    })).toBe(0);
  });

  it('counts only refunded non-gift-card merchandise including tax', () => {
    expect(calculateShopifyRefundEligibleSpend({
      refundLineItems: [
        { subtotal: '36.36', totalTax: '3.64' },
        { subtotal: '20.00', totalTax: '0.00', giftCard: true },
      ],
    })).toBe(40);
    expect(calculateShopifyRefundEligibleSpend({ refundLineItems: [] })).toBe(0);
  });

  it('allocates original order and loyalty discounts across returned eligible lines', () => {
    expect(calculatePosReturnEligibleCents({
      originalItems: [
        { id: 1, qty: 2, lineTotal: 80, discountAmount: 20 },
        { id: 2, qty: 1, lineTotal: 50, isGiftCard: true },
      ],
      originalDiscountTotal: 33,
      cumulativeReturnedQtyByItemId: new Map([[1, 1], [2, 1]]),
    })).toEqual({ originalEligibleCents: 7200, cumulativeReturnedCents: 3600 });
  });

  it('never awards negative or invalid points', () => {
    expect(calculateEarnedPoints({ merchandiseTotal: -10, earnRate: 1 })).toBe(0);
    expect(calculateEarnedPoints({ merchandiseTotal: 10, discountTotal: 20, earnRate: 1 })).toBe(0);
    expect(calculateEarnedPoints({ merchandiseTotal: 10, earnRate: Number.NaN })).toBe(0);
  });

  it('caps repeated reversals at the original earning', () => {
    expect(calculateReversalPoints(100, 30, 50)).toBe(50);
    expect(calculateReversalPoints(100, 80, 50)).toBe(20);
    expect(calculateReversalPoints(100, 100, 50)).toBe(0);
  });

  it('calculates cumulative proportional return points without rounding drift', () => {
    expect(calculateProportionalReturnReversal({
      originalEarned: 95,
      originalEligibleCents: 9500,
      cumulativeReturnedCents: 3000,
      alreadyReversed: 0,
    })).toBe(30);
    expect(calculateProportionalReturnReversal({
      originalEarned: 95,
      originalEligibleCents: 9500,
      cumulativeReturnedCents: 6200,
      alreadyReversed: 30,
    })).toBe(32);
  });

  it('caps cumulative return reversal at the original earned points', () => {
    expect(calculateProportionalReturnReversal({
      originalEarned: 95,
      originalEligibleCents: 9500,
      cumulativeReturnedCents: 12000,
      alreadyReversed: 90,
    })).toBe(5);
  });

  it('requires a positive integer reward cost and sufficient integer balance', () => {
    expect(canClaimReward(100, 100)).toBe(true);
    expect(canClaimReward(99, 100)).toBe(false);
    expect(canClaimReward(100.5, 100)).toBe(false);
    expect(canClaimReward(100, 0)).toBe(false);
  });

  it('is disabled by default when settings are missing', () => {
    expect(parseLoyaltySettings({})).toEqual({
      enabled: false,
      earnRate: 1,
      programName: 'Rewards Program',
      pointsLabel: 'Points',
      startedAt: null,
    });
    expect(parseLoyaltySettings({ loyalty_enabled: 'true' }).enabled).toBe(false);
    expect(parseLoyaltySettings({ loyalty_enabled: '1' }).enabled).toBe(true);
  });
});