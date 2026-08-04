import { describe, expect, it } from 'vitest';

import {
  calculateEarnedPoints,
  calculateEligibleSpendCents,
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