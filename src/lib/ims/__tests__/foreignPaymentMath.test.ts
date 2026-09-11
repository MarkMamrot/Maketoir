import { describe, expect, it } from 'vitest';
import {
  audAmountFromPayment,
  canonicalExchangeRate,
  displayedExchangeRate,
  exchangeRateFromPaymentAmounts,
} from '../foreignPaymentMath';

describe('foreign payment exchange-rate math', () => {
  it('derives the canonical AUD-per-foreign rate from both payment amounts', () => {
    expect(exchangeRateFromPaymentAmounts(100, 152.5)).toBeCloseTo(1.525, 8);
    expect(audAmountFromPayment(100, 1.525)).toBeCloseTo(152.5, 8);
  });

  it('converts the displayed rate in either direction', () => {
    expect(displayedExchangeRate(1.525, 'foreign_to_aud')).toBeCloseTo(1.525, 8);
    expect(displayedExchangeRate(1.525, 'aud_to_foreign')).toBeCloseTo(1 / 1.525, 8);
    expect(canonicalExchangeRate(1 / 1.525, 'aud_to_foreign')).toBeCloseTo(1.525, 8);
  });

  it('rejects unusable values', () => {
    expect(exchangeRateFromPaymentAmounts(0, 100)).toBe(0);
    expect(audAmountFromPayment(100, Number.NaN)).toBe(0);
    expect(canonicalExchangeRate(-1, 'foreign_to_aud')).toBe(0);
  });
});