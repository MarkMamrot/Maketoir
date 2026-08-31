import { describe, expect, it } from 'vitest';

import { calculateSupplierCreditTotals } from '../supplierCreditTotals';

describe('calculateSupplierCreditTotals', () => {
  it('adds tax to tax-exclusive supplier costs', () => {
    expect(calculateSupplierCreditTotals(
      [{ qty: 1, unit_cost: 50, tax_rate: 0.1 }],
      'ex_tax',
    )).toEqual({ subtotal: 50, tax_amount: 5, total_amount: 55 });
  });

  it('extracts tax from tax-inclusive supplier costs', () => {
    const totals = calculateSupplierCreditTotals(
      [{ qty: 1, unit_cost: 50, tax_rate: 0.1 }],
      'inc_tax',
    );

    expect(totals.subtotal).toBeCloseTo(45.4545, 4);
    expect(totals.tax_amount).toBeCloseTo(4.5455, 4);
    expect(totals.total_amount).toBe(50);
  });

  it('ignores line tax rates for no-tax supplier credits', () => {
    expect(calculateSupplierCreditTotals(
      [{ qty: 1, unit_cost: 50, tax_rate: 0.1 }],
      'no_tax',
    )).toEqual({ subtotal: 50, tax_amount: 0, total_amount: 50 });
  });
});