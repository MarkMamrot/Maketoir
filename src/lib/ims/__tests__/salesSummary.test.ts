import { describe, expect, it } from 'vitest';
import {
  addLocationAllRollups,
  attachedCogsMetrics,
  completeSalesSummaryCombinations,
  dayOfWeekLabel,
  hourOfDayLabel,
  parseSalesSummaryDimensions,
} from '../salesSummary';

describe('sales summary helpers', () => {
  it('parses and de-duplicates whitelisted dimensions in selection order', () => {
    expect(parseSalesSummaryDimensions('brand,location,brand,hour_of_day')).toEqual([
      'brand', 'location', 'hour_of_day',
    ]);
  });

  it('rejects empty and unknown dimensions', () => {
    expect(() => parseSalesSummaryDimensions('')).toThrow('Select at least one');
    expect(() => parseSalesSummaryDimensions('brand,sql')).toThrow('Unknown groupBy dimension: sql');
  });

  it('labels calendar dimensions and retains unknown hours', () => {
    expect(dayOfWeekLabel(1)).toBe('Sunday');
    expect(dayOfWeekLabel(7)).toBe('Saturday');
    expect(hourOfDayLabel(0)).toBe('12:00 am');
    expect(hourOfDayLabel(13)).toBe('1:00 pm');
    expect(hourOfDayLabel(null)).toBe('Unknown');
  });

  it('adds an ALL location rollup without replacing location rows', () => {
    const rows = addLocationAllRollups([
      { location_id: 1, location_name: 'City', brand: 'A', sales_amount: 10, current_soh: 2 },
      { location_id: 2, location_name: 'North', brand: 'A', sales_amount: 20, current_soh: 3 },
      { location_id: 1, location_name: 'City', brand: 'B', sales_amount: 5, current_soh: 1 },
    ], ['location_id', 'location_name', 'brand'], ['sales_amount', 'current_soh']);

    expect(rows).toContainEqual({ location_id: null, location_name: 'ALL', brand: 'A', sales_amount: 30, current_soh: 5 });
    expect(rows).toHaveLength(5);
  });

  it('completes combinations in first-heading then second-heading order', () => {
    const rows = completeSalesSummaryCombinations([
      { day_of_week: 2, brand: 'B1', sales_amount: 10 },
      { day_of_week: 3, brand: 'B2', sales_amount: 20 },
    ], [
      { keys: ['day_of_week'], values: [{ day_of_week: 2 }, { day_of_week: 3 }] },
      { keys: ['brand'], values: [{ brand: 'B1' }, { brand: 'B2' }] },
    ], ['sales_amount']);

    expect(rows).toEqual([
      { day_of_week: 2, brand: 'B1', sales_amount: 10 },
      { day_of_week: 2, brand: 'B2', sales_amount: 0 },
      { day_of_week: 3, brand: 'B1', sales_amount: 0 },
      { day_of_week: 3, brand: 'B2', sales_amount: 20 },
    ]);
  });

  it('calculates GP only from sales covered by attached COGS', () => {
    expect(attachedCogsMetrics({
      salesAmountIncTax: 220,
      coveredSalesAmountIncTax: 110,
      attachedCogs: 60,
    })).toEqual({
      grossProfit: 40,
      grossProfitPercent: 40,
      cogsCoveragePercent: 50,
    });
  });
});