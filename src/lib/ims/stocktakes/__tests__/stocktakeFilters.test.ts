import { describe, expect, it } from 'vitest';
import { parseStockOnHandFilter, stockOnHandCondition } from '../stocktakeFilters';

describe('stocktake pre-population stock-on-hand filter', () => {
  it('accepts greater-than, less-than, and equal comparisons, including negative quantities', () => {
    expect(stockOnHandCondition(parseStockOnHandFilter('gt', '5'))).toEqual({
      sql: 'COALESCE(s.qty_on_hand, 0) > ?', params: [5],
    });
    expect(stockOnHandCondition(parseStockOnHandFilter('lt', '-1.5'))).toEqual({
      sql: 'COALESCE(s.qty_on_hand, 0) < ?', params: [-1.5],
    });
    expect(stockOnHandCondition(parseStockOnHandFilter('eq', 0))).toEqual({
      sql: 'COALESCE(s.qty_on_hand, 0) = ?', params: [0],
    });
  });

  it('returns no condition when the filter is unused', () => {
    expect(parseStockOnHandFilter(undefined, undefined)).toEqual({});
    expect(stockOnHandCondition({})).toBeNull();
  });

  it('rejects incomplete and invalid filters', () => {
    expect(() => parseStockOnHandFilter('gt', '')).toThrow('requires a valid operator and quantity');
    expect(() => parseStockOnHandFilter('', '3')).toThrow('requires a valid operator and quantity');
    expect(() => parseStockOnHandFilter('gte', '3')).toThrow('requires a valid operator and quantity');
    expect(() => parseStockOnHandFilter('eq', 'not-a-number')).toThrow('must be a number');
  });
});
