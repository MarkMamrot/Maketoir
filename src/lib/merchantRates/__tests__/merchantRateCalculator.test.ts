import { describe, expect, it } from 'vitest';
import {
  calculateMerchantRateComparison,
  getTieredMerchantServiceRate,
  splitTypicalGiftBookCardTurnover,
} from '../merchantRateCalculator';

describe('splitTypicalGiftBookCardTurnover', () => {
  it('allocates turnover across a typical gift and book retailer card mix', () => {
    expect(splitTypicalGiftBookCardTurnover(100_000)).toEqual({
      visaMastercardVolume: 65_000,
      eftposVolume: 30_000,
      amexDinersVolume: 4_000,
      unionPayVolume: 1_000,
    });
  });
});

describe('getTieredMerchantServiceRate', () => {
  it.each([
    [0, 0.0025],
    [4_999_999, 0.0025],
    [5_000_000, 0.002],
    [15_000_000, 0.0018],
    [50_000_000, 0.0014],
    [250_000_000, 0.0012],
  ])('uses the attached tier for %d monthly turnover', (turnover, expected) => {
    expect(getTieredMerchantServiceRate(turnover)).toBe(expected);
  });
});

describe('calculateMerchantRateComparison', () => {
  it('compares the tiered and 0.22% options with shared monthly charges', () => {
    const result = calculateMerchantRateComparison({
      monthlyTurnover: 100_000,
      averageTransactionValue: 100,
      terminalCount: 2,
      currentMonthlyTerminalFees: 60,
      solvantisMerchantFeeRate: 0.002,
      eftposVolume: 40_000,
      visaMastercardVolume: 50_000,
      amexDinersVolume: 8_000,
      unionPayVolume: 2_000,
    });

    expect(result.estimatedTransactions).toBe(1_000);
    expect(result.estimatedEftposTransactions).toBe(400);
    expect(result.tiered.merchantServiceFees).toBeCloseTo(289);
    expect(result.tiered.interchangeSchemeFees).toBeCloseTo(200);
    expect(result.tiered.eftposTransactionFees).toBeCloseTo(66);
    expect(result.tiered.solvantisMerchantFees).toBeCloseTo(100);
    expect(result.flat.merchantServiceFees).toBeCloseTo(362);
    expect(result.flat.interchangeSchemeFees).toBeCloseTo(300);
    expect(result.flat.solvantisMerchantFees).toBeCloseTo(180);
    expect(result.tiered.monthlyTotal).toBeCloseTo(757.5);
    expect(result.flat.transactionFees).toBe(0);
    expect(result.flat.administrationFees).toBe(0);
    expect(result.flat.monthlyTotal).toBeCloseTo(912);
    expect(result.cheaperOption).toBe('tiered');
    expect(result.annualSaving).toBeCloseTo(1_854);
  });

  it('applies the monthly minimum service fee and normalises invalid inputs', () => {
    const result = calculateMerchantRateComparison({
      monthlyTurnover: 1_000,
      averageTransactionValue: 100,
      terminalCount: -2,
      currentMonthlyTerminalFees: -50,
      solvantisMerchantFeeRate: 0.002,
      eftposVolume: Number.NaN,
      visaMastercardVolume: 500,
      amexDinersVolume: 0,
      unionPayVolume: 0,
    });

    expect(result.tiered.merchantServiceFees).toBeCloseTo(1.25);
    expect(result.tiered.interchangeSchemeFees).toBeCloseTo(2);
    expect(result.tiered.solvantisMerchantFees).toBeCloseTo(1);
    expect(result.tiered.minimumServiceFeeAdjustment).toBeCloseTo(28.75);
    expect(result.tiered.monthlyTotal).toBeCloseTo(35.8);
    expect(result.enteredCardVolume).toBe(500);
    expect(result.unallocatedTurnover).toBe(500);
  });
});