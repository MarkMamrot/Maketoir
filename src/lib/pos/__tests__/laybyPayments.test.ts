import { describe, expect, it } from 'vitest';
import { canSaveLaybyDeposit } from '../laybyPayments';

describe('canSaveLaybyDeposit', () => {
  it('accepts a $26 deposit without inventing the $103.95 balance payment', () => {
    expect(canSaveLaybyDeposit(129.95, [26])).toBe(true);
  });
  it('accepts split deposits and fully paid laybys', () => {
    expect(canSaveLaybyDeposit(129.95, [20, 6])).toBe(true);
    expect(canSaveLaybyDeposit(129.95, [26, 103.95])).toBe(true);
  });
  it.each([[], [0], [-26], [130], [NaN], [Infinity]].map(amounts => ({ amounts })))('rejects invalid deposits: $amounts', ({ amounts }) => {
    expect(canSaveLaybyDeposit(129.95, amounts)).toBe(false);
  });
});