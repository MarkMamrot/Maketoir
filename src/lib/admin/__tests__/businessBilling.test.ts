import { describe, expect, it } from 'vitest';
import {
  billingAmountAud, billingAmountCents, businessBillingMonths, currentBillingMonth,
  validateBillingEntries, validatePlanStartDate,
} from '../businessBilling';

const now = new Date('2026-10-16T01:00:00Z');
const entry = { month: '2026-09', paymentPlan: 'Core monthly', amountAud: '149.50', paid: false, revision: 0 };

describe('manual business billing', () => {
  it('generates months inclusively, never future months or inferred charges', () => {
    expect(businessBillingMonths('2026-08-20', [], now)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(businessBillingMonths('2026-12-01', [], now)).toEqual([]);
    expect(businessBillingMonths(null, [], now)).toEqual([]);
  });
  it('retains saved history when the start date is moved forward or cleared', () => {
    expect(businessBillingMonths('2026-10-01', [entry], now)).toEqual(['2026-09', '2026-10']);
    expect(businessBillingMonths(null, [entry], now)).toEqual(['2026-09']);
  });
  it('uses Australian calendar months at UTC month boundaries', () => {
    expect(currentBillingMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
  });
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', 'invalid', undefined])('rejects invalid start dates: %j', value => {
    expect(() => validatePlanStartDate(value)).toThrow('valid plan start date');
  });
  it('allows real dates and an explicitly unset date', () => {
    expect(validatePlanStartDate('2024-02-29')).toBe('2024-02-29');
    expect(validatePlanStartDate(null)).toBeNull();
    expect(validatePlanStartDate('')).toBeNull();
  });
  it.each([['0', 0], ['0.01', 1], ['149.50', 14950], ['1.1', 110], ['999999999.99', 99999999999]])('stores exact cents for %s', (value, cents) => {
    expect(billingAmountCents(value)).toBe(cents);
    expect(billingAmountCents(billingAmountAud(cents))).toBe(cents);
  });
  it.each(['', '-1', '1.001', '1e3', '1,000', '1000000000', null, 10])('rejects ambiguous or invalid money: %j', value => {
    expect(() => billingAmountCents(value)).toThrow('AUD amount');
  });
  it('keeps zero-dollar and explicitly paid records distinct from unrecorded months', () => {
    expect(validateBillingEntries([{ ...entry, amountAud: '0', paid: true }], now))
      .toEqual([{ ...entry, amountAud: '0.00', paid: true }]);
    expect(validateBillingEntries([], now)).toEqual([]);
  });
  it.each([
    { entries: [{ ...entry, month: '2026-11' }] },
    { entries: [{ ...entry, month: '2026-00' }] },
    { entries: [entry, entry] },
    { entries: [{ ...entry, paymentPlan: '' }] },
    { entries: [{ ...entry, paid: 1 }] },
    { entries: [{ ...entry, revision: -1 }] },
  ])('rejects invalid monthly history: $entries', ({ entries }) => {
    expect(() => validateBillingEntries(entries, now)).toThrow();
  });
});
