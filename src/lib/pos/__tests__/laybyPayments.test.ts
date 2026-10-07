import { describe, expect, it } from 'vitest';
import { canSaveLaybyDeposit, laybyFeePercent, planLaybyCancellation, planLaybyPayment } from '../laybyPayments';

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

describe('layby lifecycle money rules', () => {
  it('records instalments without completing an unpaid layby', () => {
    expect(planLaybyPayment({ total: 129.95, paid: 26, amount: 30, collect: false })).toEqual({ paid: 56, balance: 73.95, fullyPaid: false, collect: false });
  });
  it('allows final payment with collection or awaiting collection', () => {
    expect(planLaybyPayment({ total: 129.95, paid: 26, amount: 103.95, collect: true }).collect).toBe(true);
    expect(planLaybyPayment({ total: 129.95, paid: 26, amount: 103.95, collect: false })).toEqual({ paid: 129.95, balance: 0, fullyPaid: true, collect: false });
  });
  it('rejects premature collection and overpayment', () => {
    expect(() => planLaybyPayment({ total: 129.95, paid: 26, amount: 30, collect: true })).toThrow();
    expect(() => planLaybyPayment({ total: 129.95, paid: 26, amount: 104, collect: false })).toThrow();
  });
  it('defaults to no fee and caps the configured fee at actual payments', () => {
    expect(laybyFeePercent(null)).toBe(0);
    expect(planLaybyCancellation({ total: 129.95, paid: 26, feePercent: 0 })).toMatchObject({ fee: 0, refund: 26 });
    expect(planLaybyCancellation({ total: 129.95, paid: 10, feePercent: 20 })).toMatchObject({ fee: 10, refund: 0 });
  });
  it('requires a reason for staff overrides', () => {
    expect(() => planLaybyCancellation({ total: 129.95, paid: 26, feePercent: 20, overrideFee: 0 })).toThrow();
    expect(planLaybyCancellation({ total: 129.95, paid: 26, feePercent: 20, overrideFee: 0, reason: 'Approved goodwill waiver' })).toMatchObject({ fee: 0, refund: 26, overridden: true });
  });
});