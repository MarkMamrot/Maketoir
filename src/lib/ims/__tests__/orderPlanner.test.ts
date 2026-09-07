import { describe, expect, it } from 'vitest';

import { calculateReorderSuggestion } from '../orderPlanner';

describe('calculateReorderSuggestion', () => {
  it('uses sales velocity across cadence and lead time, then subtracts available and incoming stock', () => {
    expect(calculateReorderSuggestion({
      salesQuantity: 90,
      salesWindowDays: 90,
      createdDate: null,
      supplierLeadTimeDays: 14,
      orderFrequencyDays: 30,
      availableQuantity: 8,
      incomingQuantity: 10,
      packSize: 0,
      now: Date.parse('2026-09-05T00:00:00Z'),
    })).toEqual({
      daysInStock: 90,
      effectiveSalesDays: 90,
      averageDailySales: 1,
      coverageDays: 44,
      suggestedQuantity: 26,
      reorderQuantity: 26,
    });
  });

  it('uses the shorter selling history for a new product and rounds to its pack size', () => {
    expect(calculateReorderSuggestion({
      salesQuantity: 10,
      salesWindowDays: 90,
      createdDate: '2026-08-12T00:00:00Z',
      supplierLeadTimeDays: 4,
      orderFrequencyDays: 10,
      availableQuantity: 1,
      incomingQuantity: 0,
      packSize: 6,
      now: Date.parse('2026-09-05T00:00:00Z'),
    })).toEqual({
      daysInStock: 20,
      effectiveSalesDays: 20,
      averageDailySales: 0.5,
      coverageDays: 14,
      suggestedQuantity: 6,
      reorderQuantity: 6,
    });
  });
});
