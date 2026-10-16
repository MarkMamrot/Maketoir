import { describe, expect, it } from 'vitest';
import { assertTransition, eventAmounts, eventFingerprint, localDate, projectActivity, requireDate, requirePeriod, safeCsvCell, type ConsignmentEvent } from '../domain';

const sale = (overrides: Partial<ConsignmentEvent> = {}): ConsignmentEvent => ({
  id: 1, business_id: 'tenant-a', supplier_id: 12, source_type: 'sale', source_id: 'SO-1', source_line_id: 'line-1',
  event_key: 'sale:1', original_event_id: null, variant_id: 'variant', sku: 'A', product_name: 'Product',
  location_id: 1, channel: 'pos', event_date: '2026-10-16', quantity: '3.000000', unit_cost: '2.34000000',
  tax_rate: '10.000000', tracking_interval_id: null, statement_id: null, exception: null, ...overrides,
});
describe('consignment financial source projection', () => {
  it('uses captured supplier cost and separate GST without adding retail GST', () => {
    expect(eventAmounts(sale())).toEqual({ subtotal: 7.02, tax: 0.7, total: 7.72 });
  });
  it('supports GST free and genuine zero cost, distinct from missing evidence', () => {
    const result = projectActivity([sale({ unit_cost: 0, tax_rate: 0 })]);
    expect(result.totals.total).toBe(0); expect(result.exceptions).toEqual([]);
    expect(projectActivity([sale({ unit_cost: null })]).exceptions[0].message).toContain('Missing');
  });
  it('refunds deduct original cost whether or not physically restocked; reversal restores it', () => {
    const result = projectActivity([sale(), sale({ id: 2, source_type: 'refund', quantity: -1, original_event_id: 1 }),
      sale({ id: 3, source_type: 'refund_reversal', quantity: 1, original_event_id: 2 })]);
    expect(result.totals.netQuantity).toBe(3); expect(result.totals.total).toBe(7.72);
    expect(result.totals.quantitySold).toBe(3); expect(result.totals.quantityRefunded).toBe(0);
  });
  it('supplier returns remain source evidence but never reduce sales dues', () => {
    const result = projectActivity([sale(), sale({ id: 2, source_type: 'supplier_return', quantity: -20, unit_cost: null, tax_rate: null }),
      sale({ id: 3, source_type: 'supplier_return', quantity: 20, original_event_id: 2, unit_cost: null, tax_rate: null })]);
    expect(result.events).toHaveLength(3); expect(result.totals.total).toBe(7.72); expect(result.exceptions).toEqual([]);
  });
  it('groups costs separately and does not treat off-mode report history as debt', () => {
    const result = projectActivity([sale(), sale({ id: 2, unit_cost: 5 })]);
    expect(result.rows).toHaveLength(2); expect(result.label).toContain('not a settlement or outstanding balance');
    expect(result.totals.total).toBe(24.22);
  });
  it('preserves negative net amounts and uses symmetric half-up source rounding', () => {
    expect(eventAmounts(sale({ quantity: -1, source_type: 'refund', unit_cost: '0.005', tax_rate: 0 })).total).toBe(-0.01);
    expect(projectActivity([sale({ quantity: -4, source_type: 'refund', original_event_id: 1 })]).totals.total).toBe(-10.3);
  });
  it('fingerprints source costs and membership, independent of row order and claims', () => {
    const a = sale(); const b = sale({ id: 2 });
    expect(eventFingerprint([a, b])).toBe(eventFingerprint([b, a]));
    expect(eventFingerprint([a])).not.toBe(eventFingerprint([sale({ unit_cost: 7 })]));
    expect(eventFingerprint([a])).toBe(eventFingerprint([sale({ statement_id: 9 })]));
  });
  it('exposes cross-cutover exceptions rather than silently clearing them', () => {
    expect(projectActivity([sale({ exception: 'Cross-cutover refund requires manual review' })]).exceptions).toHaveLength(1);
  });
});
describe('consignment shared validation', () => {
  it('rejects invalid dates and reversed periods', () => {
    expect(() => requireDate('2026-02-30')).toThrow(); expect(() => requireDate('2026-99-99')).toThrow();
    expect(() => requirePeriod('2026-10-02', '2026-10-01')).toThrow();
    expect(requireDate('2024-02-29')).toBe('2024-02-29');
  });
  it('calculates local dates across Australian UTC boundaries', () => {
    expect(localDate(new Date('2026-10-15T15:00:00Z'), 'Australia/Sydney')).toBe('2026-10-16');
  });
  it('never reopens or cancels accounted statements', () => {
    expect(() => assertTransition('Accounted', 'cancel')).toThrow();
    expect(() => assertTransition('Cancelled', 'finalise')).toThrow();
    expect(() => assertTransition('Finalised', 'account')).not.toThrow();
  });
  it('escapes CSV quotes and spreadsheet formulas', () => {
    expect(safeCsvCell('=IMPORTDATA("evil")')).toBe('"\'=IMPORTDATA(""evil"")"');
    expect(safeCsvCell('Product, one')).toBe('"Product, one"');
  });
});
