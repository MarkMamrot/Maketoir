import { describe, expect, it } from 'vitest';
import {
  isExpectedDateDelay,
  normalizeExpectedDate,
  normalizeStockAllocationExceptionGroups,
} from '../stockAllocation/exceptionNotifications';

describe('normalizeStockAllocationExceptionGroups', () => {
  it('returns one normalized exception group per affected sales order', () => {
    expect(normalizeStockAllocationExceptionGroups([
      { so_id: '41', so_number: 'SO-41', affected_quantity: '3.12506', allocation_count: '2' },
      { so_id: 42, so_number: 'SO-42', affected_quantity: 1, allocation_count: 1 },
    ])).toEqual([
      { soId: 41, soNumber: 'SO-41', affectedQuantity: 3.1251, allocationCount: 2 },
      { soId: 42, soNumber: 'SO-42', affectedQuantity: 1, allocationCount: 1 },
    ]);
  });

  it('drops groups with no remaining affected protection', () => {
    expect(normalizeStockAllocationExceptionGroups([
      { so_id: 41, so_number: 'SO-41', affected_quantity: 0, allocation_count: 2 },
      { so_id: 0, so_number: 'Missing', affected_quantity: 2, allocation_count: 1 },
    ])).toEqual([]);
  });
});

describe('expected date exception detection', () => {
  it('normalizes driver Date values and only flags later or removed dates', () => {
    expect(normalizeExpectedDate(new Date('2026-08-20T00:00:00.000Z'))).toBe('2026-08-20');
    expect(isExpectedDateDelay(new Date('2026-08-20T00:00:00.000Z'), '2026-08-20')).toBe(false);
    expect(isExpectedDateDelay('2026-08-20', '2026-08-25')).toBe(true);
    expect(isExpectedDateDelay('2026-08-20', null)).toBe(true);
    expect(isExpectedDateDelay('2026-08-20', '2026-08-18')).toBe(false);
  });
});