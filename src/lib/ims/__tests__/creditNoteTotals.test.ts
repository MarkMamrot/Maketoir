import { describe, expect, it } from 'vitest';
import { calculateCNTotals } from '../ImsRepository';

describe('calculateCNTotals', () => {
  it('extracts GST from tax-inclusive credit-note prices', () => {
    const totals = calculateCNTotals(
      [{ qty: 2, unit_price: 55, tax_rate: 0.1 }],
      'inc_tax',
    );

    expect(totals.subtotal).toBeCloseTo(100, 8);
    expect(totals.tax_amount).toBeCloseTo(10, 8);
    expect(totals.total_amount).toBeCloseTo(110, 8);
  });

  it('adds GST to tax-exclusive credit-note prices', () => {
    const totals = calculateCNTotals(
      [{ qty: 2, unit_price: 50, tax_rate: 0.1 }],
      'ex_tax',
    );

    expect(totals.subtotal).toBeCloseTo(100, 8);
    expect(totals.tax_amount).toBeCloseTo(10, 8);
    expect(totals.total_amount).toBeCloseTo(110, 8);
  });

  it('keeps no-tax credit notes tax-free even when a source line has a tax rate', () => {
    const totals = calculateCNTotals(
      [{ qty: 2, unit_price: 50, tax_rate: 0.1 }],
      'no_tax',
    );

    expect(totals.subtotal).toBeCloseTo(100, 8);
    expect(totals.tax_amount).toBe(0);
    expect(totals.total_amount).toBeCloseTo(100, 8);
  });
});