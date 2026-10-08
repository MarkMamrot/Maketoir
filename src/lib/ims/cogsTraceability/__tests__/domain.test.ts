import { describe, expect, it } from 'vitest';
import { csvCell, emptyRow, exclusive, financials, groupRows, matches, summarise, type ReportRow } from '../domain';

describe('COGS traceability financial evidence', () => {
  it('extracts GST only from tax inclusive amounts', () => {
    expect(exclusive(110, .1, 'inc_tax')).toBeCloseTo(100);
    expect(exclusive(100, .1, 'ex_tax')).toBe(100);
    expect(exclusive(100, 0, 'no_tax')).toBe(100);
  });
  it('preserves signed discounts, refunds and COGS', () => {
    expect(financials({ gross: -100, net: -80, tax: -8, currency: 'AUD', exchangeRate: null, cogs: -50 }))
      .toMatchObject({ sales: -100, discount: -20, netSales: -80, cogs: -50, gp: -30, gpPercent: 37.5 });
  });
  it('does not fabricate missing costs or exchange rates', () => {
    expect(financials({ gross: 100, net: 80, tax: 8, currency: 'AUD', exchangeRate: null, cogs: null }).gp).toBeNull();
    expect(financials({ gross: 100, net: 80, tax: 8, currency: 'USD', exchangeRate: null, cogs: 50 }).netSales).toBeNull();
    expect(financials({ gross: 100, net: 80, tax: 8, currency: 'USD', exchangeRate: 1.5, cogs: 50 }).gp).toBe(70);
  });
  it('leaves zero revenue percentages blank and permits known zero costs', () => {
    expect(financials({ gross: 0, net: 0, tax: 0, currency: 'AUD', exchangeRate: 1, cogs: 0 }).gpPercent).toBeNull();
    expect(financials({ gross: 10, net: 10, tax: 0, currency: 'AUD', exchangeRate: 1, cogs: 0 }).gp).toBe(10);
  });
  it('calculates weighted summary margin and propagates incomplete costs', () => {
    const rows: ReportRow[] = [Object.assign(emptyRow('1'), { channel: 'POS', qty: 1, netSales: 100, cogs: 50 }), Object.assign(emptyRow('2'), { channel: 'POS', qty: 1, netSales: 900, cogs: 810 })];
    expect(summarise(rows)).toMatchObject({ netSales: 1000, cogs: 860, gp: 140 });
    expect(summarise(rows).gpPercent).toBeCloseTo(14);
    expect(groupRows(rows, ['channel'])[0].gpPercent).toBeCloseTo(14);
    rows[1].cogs = null;
    expect(summarise(rows)).toMatchObject({ cogs: null, gp: null, knownCogs: 50, missingCosts: 1 });
    expect(groupRows(rows, ['channel'])[0]).toMatchObject({ cogs: null, gp: null, knownCogs: 50, costedRecords: 1, missingCosts: 1 });
  });
  it('retains known sales and covered GP without presenting them as complete totals', () => {
    const rows: ReportRow[] = [
      Object.assign(emptyRow('1'), { sales: 110, discount: 10, netSales: 100, cogs: 60, gp: 40 }),
      Object.assign(emptyRow('2'), { sales: null, discount: null, netSales: null, cogs: 20, gp: null }),
    ];
    expect(summarise(rows)).toMatchObject({ sales: null, netSales: null, gp: null, knownSales: 110,
      knownDiscount: 10, knownNetSales: 100, knownGp: 40, missingRevenue: 1 });
    expect(groupRows(rows, ['channel'])[0]).toMatchObject({ netSales: null, knownNetSales: 100, gp: null, knownGp: 40 });
  });
  it('supports typed filters and guards spreadsheet formulas', () => {
    const row = Object.assign(emptyRow('1'), { channel: 'Shopify', cogs: 42 });
    expect(matches(row, [{ field: 'channel', operator: 'contains', value: 'shop' }, { field: 'cogs', operator: 'gte', value: '40' }])).toBe(true);
    expect(matches(row, [{ field: 'invoiceDate', operator: 'missing', value: '' }])).toBe(true);
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell(-12)).toBe('"-12"');
  });
});