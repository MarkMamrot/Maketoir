import { describe, expect, it } from 'vitest';
import {
  buildPosReturnCreditNoteItems,
  calculatePosProfitability,
  getPosStockQtyChange,
  isPosExchange,
  normalizePosTaxRate,
} from '../posReturnCreditNote';

describe('POS return credit-note normalization', () => {
  const exchangeItems = [
    { variant_id: 'keyring', code: 'UP172255', name: 'Oz Icons Keyring Yellow 12cm', qty: -2, unit_price: 13.95, line_total: -27.90, tax_rate: 10 },
    { variant_id: 'planter-1', code: 'UG196061', name: 'Hugging Koalas Planter Grey 11cm', qty: 1, unit_price: 14.95, line_total: 14.95, tax_rate: 10 },
    { variant_id: 'planter-2', code: 'UG136352', name: 'Koala Head Planter Grey 14cm', qty: 1, unit_price: 15.95, line_total: 15.95, tax_rate: 10 },
  ];

  it('keeps only returned lines from a mixed exchange', () => {
    expect(buildPosReturnCreditNoteItems(exchangeItems)).toEqual([{
      variant_id: 'keyring',
      code: 'UP172255',
      name: 'Oz Icons Keyring Yellow 12cm',
      qty: 2,
      unit_price: 13.95,
      price_basis: 'custom',
      restock: true,
      tax_rate: 0.1,
    }]);
  });

  it('recognises mixed positive and negative lines as an exchange', () => {
    expect(isPosExchange(exchangeItems)).toBe(true);
    expect(isPosExchange(exchangeItems.slice(0, 1))).toBe(false);
  });

  it('accepts POS percentage and IMS decimal tax rates', () => {
    expect(normalizePosTaxRate(10)).toBe(0.1);
    expect(normalizePosTaxRate(0.1)).toBe(0.1);
  });

  it('deducts new exchange items while leaving returned items to the credit note', () => {
    expect(getPosStockQtyChange(-2, 'return')).toBeNull();
    expect(getPosStockQtyChange(1, 'return')).toBe(-1);
    expect(getPosStockQtyChange(2, 'sale')).toBe(-2);
    expect(getPosStockQtyChange(-2, 'sale')).toBe(2);
  });

  it('calculates exchange revenue and COGS on a signed net basis', () => {
    const result = calculatePosProfitability([
      { qty: -2, lineTotal: -27.90, taxRate: 10, unitCost: 4 },
      { qty: 1, lineTotal: 15.95, taxRate: 10, unitCost: 6 },
      { qty: 1, lineTotal: 14.95, taxRate: 10, unitCost: 5 },
    ]);

    expect(result.revenueEx).toBeCloseTo(3 / 1.1);
    expect(result.totalCogs).toBe(3);
    expect(result.grossProfit).toBeCloseTo((3 / 1.1) - 3);
    expect(result.marginPct).toBeCloseTo(-10);
  });
});