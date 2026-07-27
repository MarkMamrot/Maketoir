import { describe, expect, it } from 'vitest';
import { resolvePosItemUnitCost, summarizePosMargin } from '../posSaleCosts';

describe('resolvePosItemUnitCost', () => {
  it('prefers explicit unit cost before avg cost fallback', () => {
    expect(resolvePosItemUnitCost({ unit_cost: '4.25', avg_cost: '8.10' })).toBe(4.25);
    expect(resolvePosItemUnitCost({ avg_cost: '8.10' })).toBe(8.1);
    expect(resolvePosItemUnitCost({ unit_cost: null, avg_cost: null })).toBeNull();
  });
});

describe('summarizePosMargin', () => {
  it('calculates ex-tax revenue, cogs, and gross margin from POS-style tax rates', () => {
    const summary = summarizePosMargin([
      { qty: 2, line_total: 22, tax_rate: 10, avg_cost: 4 },
      { qty: 1, line_total: 11, tax_rate: 10, avg_cost: 3 },
    ]);

    expect(summary.revenueEx).toBeCloseTo(30, 6);
    expect(summary.totalCogs).toBeCloseTo(11, 6);
    expect(summary.grossProfit).toBeCloseTo(19, 6);
    expect(summary.marginPct).toBeCloseTo(63.333333, 5);
  });

  it('supports decimal tax rates and missing costs', () => {
    const summary = summarizePosMargin([
      { qty: 1, line_total: 110, tax_rate: 0.1, avg_cost: null },
    ]);

    expect(summary.revenueEx).toBeCloseTo(100, 6);
    expect(summary.totalCogs).toBeNull();
    expect(summary.grossProfit).toBeNull();
    expect(summary.marginPct).toBeNull();
  });
});