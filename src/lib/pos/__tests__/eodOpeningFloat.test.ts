import { describe, expect, it } from 'vitest';
import { resolveEodOpeningFloat } from '../eodOpeningFloat';

describe('resolveEodOpeningFloat', () => {
  it('prefers a saved EOD value over the register session and business default', () => {
    expect(resolveEodOpeningFloat({
      paymentMethod: 'Cash',
      savedOpeningFloat: '350.00',
      sessionOpeningFloat: '400.00',
      defaultOpeningFloat: 400,
    })).toBe(350);
  });

  it('uses the register session float when no EOD row exists', () => {
    expect(resolveEodOpeningFloat({
      paymentMethod: 'Cash',
      sessionOpeningFloat: '400.00',
      defaultOpeningFloat: 0,
    })).toBe(400);
  });

  it('falls back to the business default for Cash only', () => {
    expect(resolveEodOpeningFloat({ paymentMethod: 'Cash', defaultOpeningFloat: '400' })).toBe(400);
    expect(resolveEodOpeningFloat({ paymentMethod: 'Card', sessionOpeningFloat: 400, defaultOpeningFloat: 400 })).toBe(0);
  });
});