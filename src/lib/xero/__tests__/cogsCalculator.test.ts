import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { calculateCogsForPeriod, summariseCogsRows, validateCogsDateRange } from '../cogsCalculator';

describe('summariseCogsRows', () => {
  it('separates eligible, imported, orphaned, and uncosted movements', () => {
    const result = summariseCogsRows([
      { location_id: 1, channel: 'pos', source_status: 'eligible', cost_status: 'ok', movement_count: 3, quantity: 4, cogs: 40.125 },
      { location_id: 1, channel: 'pos', source_status: 'eligible', cost_status: 'missing', movement_count: 1, quantity: 2, cogs: 0 },
      { location_id: 2, channel: 'online', source_status: 'eligible', cost_status: 'zero', movement_count: 2, quantity: 3, cogs: 0 },
      { location_id: 2, channel: 'wholesale', source_status: 'historical_import', cost_status: 'ok', movement_count: 5, quantity: 8, cogs: 80 },
      { location_id: 3, channel: 'pos', source_status: 'orphaned', cost_status: 'ok', movement_count: 1, quantity: 1, cogs: 10 },
    ], '2026-07-01', '2026-08-01');

    expect(result).toMatchObject({
      totalCOGS: 40.13,
      includedMovementCount: 6,
      includedQuantity: 9,
      missingCostMovementCount: 1,
      missingCostQuantity: 2,
      zeroCostMovementCount: 2,
      zeroCostQuantity: 3,
      excludedHistoricalMovementCount: 5,
      excludedHistoricalQuantity: 8,
      orphanedMovementCount: 1,
      orphanedQuantity: 1,
      blocked: true,
    });
    expect(result.breakdown).toHaveLength(3);
  });

  it('allows signed return and edit rows to reduce net COGS', () => {
    const result = summariseCogsRows([
      { location_id: 1, channel: 'pos', source_status: 'eligible', cost_status: 'ok', movement_count: 4, quantity: 7, cogs: -12.5 },
    ], '2026-07-01', '2026-07-02');
    expect(result.totalCOGS).toBe(-12.5);
    expect(result.blocked).toBe(false);
  });
});

describe('calculateCogsForPeriod', () => {
  beforeEach(() => mockImsQuery.mockReset());

  it('queries a half-open period and returns its summary', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { location_id: 1, channel: 'pos', source_status: 'eligible', cost_status: 'ok', movement_count: '2', quantity: '3', cogs: '15.555' },
    ]);

    const result = await calculateCogsForPeriod({
      businessId: 'biz-1',
      startDate: '2026-07-01',
      endDateExclusive: '2026-08-01',
    });

    expect(result.totalCOGS).toBe(15.56);
    expect(mockImsQuery).toHaveBeenCalledOnce();
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', '2026-07-01', '2026-08-01']);
  });
});

describe('validateCogsDateRange', () => {
  it('rejects malformed and reversed ranges', () => {
    expect(() => validateCogsDateRange('01-07-2026', '2026-08-01')).toThrow();
    expect(() => validateCogsDateRange('2026-08-01', '2026-08-01')).toThrow();
  });
});