import { describe, expect, it } from 'vitest';
import {
  EMPTY_MULTI,
  WINDOW_OPTS,
  hasMultiFilter,
  multiFilterParams,
  previousCalendarPeriod,
  type FilterSelection,
  type MultiFilter,
} from '../reportFilterUtils';

function pick(type: FilterSelection['type'], value: string, label = 'label'): FilterSelection {
  return { type, value, label };
}

describe('reportFilterHelpers', () => {
  describe('EMPTY_MULTI', () => {
    it('initializes all filter slots as null', () => {
      expect(EMPTY_MULTI).toEqual({
        product: null,
        supplier: null,
        brand: null,
        type_: null,
        category: null,
        subcategory: null,
      });
    });
  });

  describe('multiFilterParams', () => {
    it('maps selected filters to API query params', () => {
      const filters: MultiFilter = {
        product: pick('product', '123', 'Product: Tee'),
        supplier: pick('supplier', '88', 'Supplier: Acme'),
        brand: pick('brand', 'Nike', 'Brand: Nike'),
        type_: pick('product_type', 'Apparel', 'Type: Apparel'),
        category: pick('category', 'Mens', 'Category: Mens'),
        subcategory: pick('subcategory', 'Tees', 'Subcategory: Tees'),
      };

      expect(multiFilterParams(filters)).toEqual({
        productId: '123',
        supplierId: '88',
        brand: 'Nike',
        productType: 'Apparel',
        category: 'Mens',
        subcategory: 'Tees',
      });
    });

    it('omits keys for null filters', () => {
      expect(multiFilterParams(EMPTY_MULTI)).toEqual({});
    });
  });

  describe('hasMultiFilter', () => {
    it('returns false when all primary filters are empty', () => {
      expect(hasMultiFilter(EMPTY_MULTI)).toBe(false);
    });

    it('returns true when any primary filter is selected', () => {
      expect(
        hasMultiFilter({
          ...EMPTY_MULTI,
          brand: pick('brand', 'Nike', 'Brand: Nike'),
        }),
      ).toBe(true);
    });

    it('ignores category-only and subcategory-only selections', () => {
      expect(
        hasMultiFilter({
          ...EMPTY_MULTI,
          category: pick('category', 'Mens', 'Category: Mens'),
        }),
      ).toBe(false);

      expect(
        hasMultiFilter({
          ...EMPTY_MULTI,
          subcategory: pick('subcategory', 'Tees', 'Subcategory: Tees'),
        }),
      ).toBe(false);
    });
  });

  describe('WINDOW_OPTS', () => {
    it('keeps the expected reporting windows in order', () => {
      expect(WINDOW_OPTS).toEqual([
        { value: 7, label: '7 Days' },
        { value: 90, label: '90 Days' },
        { value: 180, label: '180 Days' },
        { value: 365, label: '12 Months' },
      ]);
    });
  });

  describe('previousCalendarPeriod', () => {
    it('returns the previous Monday-to-Sunday week', () => {
      expect(previousCalendarPeriod('week', new Date(2026, 7, 7))).toEqual({
        kind: 'range',
        from: '2026-07-27',
        to: '2026-08-02',
        label: 'Previous Week',
      });
    });

    it('handles month and quarter rollover into the prior year', () => {
      const now = new Date(2026, 0, 15);
      expect(previousCalendarPeriod('month', now)).toEqual({
        kind: 'range', from: '2025-12-01', to: '2025-12-31', label: 'Previous Month',
      });
      expect(previousCalendarPeriod('quarter', now)).toEqual({
        kind: 'range', from: '2025-10-01', to: '2025-12-31', label: 'Previous Quarter',
      });
    });

    it('returns the complete previous calendar year', () => {
      expect(previousCalendarPeriod('year', new Date(2026, 7, 7))).toEqual({
        kind: 'range', from: '2025-01-01', to: '2025-12-31', label: 'Previous Year',
      });
    });
  });
});