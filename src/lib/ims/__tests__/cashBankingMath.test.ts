import { describe, expect, it } from 'vitest';
import {
  calculateCashPosition,
  classifyCashVariance,
  splitExpectedCashTender,
} from '../cashBankingMath';

describe('calculateCashPosition', () => {
  it('separates expected sales, float, till variance, and banking variance', () => {
    expect(calculateCashPosition({
      expectedAmount: 100,
      countedAmount: 149.95,
      openingFloat: 50,
      depositCounted: 99.9,
    })).toEqual({
      cashTenderExpected: 100,
      drawerCashAvailable: 99.95,
      tillVariance: -0.05,
      tillVarianceDirection: 'short',
      depositCounted: 99.9,
      bankingVariance: -0.05,
      bankingVarianceDirection: 'short',
    });
  });

  it('uses cent arithmetic for decimal inputs', () => {
    const result = calculateCashPosition({
      expectedAmount: 0.1 + 0.2,
      countedAmount: 50.3,
      openingFloat: 50,
      depositCounted: 0.3,
    });
    expect(result.tillVariance).toBe(0);
    expect(result.bankingVariance).toBe(0);
  });
});

describe('splitExpectedCashTender', () => {
  it('keeps sales and rounding equal to the expected tender total', () => {
    expect(splitExpectedCashTender({ expectedAmount: 100.05, cashRounding: 0.05 })).toEqual({
      salesAmount: 100,
      roundingAmount: 0.05,
      invoiceTotal: 100.05,
    });
  });

  it('supports negative cash rounding without changing the invoice total', () => {
    expect(splitExpectedCashTender({ expectedAmount: 99.95, cashRounding: -0.05 })).toEqual({
      salesAmount: 100,
      roundingAmount: -0.05,
      invoiceTotal: 99.95,
    });
  });
});

describe('classifyCashVariance', () => {
  it.each([
    [-0.01, 'short'],
    [0, 'exact'],
    [0.01, 'over'],
  ] as const)('classifies %s as %s', (amount, expected) => {
    expect(classifyCashVariance(amount)).toBe(expected);
  });
});