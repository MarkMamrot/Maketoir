import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCalculate, mockExecute, mockQuery, mockSync } = vi.hoisted(() => ({
  mockCalculate: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockSync: vi.fn(),
}));

vi.mock('@/lib/xero/cogsCalculator', () => ({ calculateCogsForPeriod: mockCalculate }));
vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn().mockResolvedValue([{ id: 1, name: 'Warehouse' }, { id: 2, name: 'Newtown' }]) }));
vi.mock('@/services/XeroSyncService', () => ({ syncCogsJournal: mockSync }));

import { postCogsPeriod } from '../XeroCogsService';

const period = {
  frequency: 'monthly' as const,
  startDate: '2026-06-01',
  endDateExclusive: '2026-07-01',
  journalDate: '2026-06-30',
  key: 'monthly:2026-06-01:2026-07-01',
  label: 'June 2026',
};

const calculation = {
  startDate: period.startDate,
  endDateExclusive: period.endDateExclusive,
  totalCOGS: 100,
  includedMovementCount: 4,
  includedQuantity: 4,
  missingCostMovementCount: 0,
  missingCostQuantity: 0,
  zeroCostMovementCount: 0,
  zeroCostQuantity: 0,
  excludedHistoricalMovementCount: 2,
  excludedHistoricalQuantity: 2,
  orphanedMovementCount: 0,
  orphanedQuantity: 0,
  blocked: false,
  breakdown: [
    { locationId: 1, channel: 'online', totalCOGS: 60, movementCount: 2, quantity: 2 },
    { locationId: 2, channel: 'pos', totalCOGS: 40, movementCount: 2, quantity: 2 },
  ],
};

describe('postCogsPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalculate.mockResolvedValue(calculation);
    mockQuery.mockResolvedValueOnce([{ posted_total: 0, successful_runs: 0 }]).mockResolvedValueOnce([]);
    mockExecute.mockResolvedValue({ insertId: 41, affectedRows: 1 });
    mockSync.mockResolvedValue({ journalId: 'xero-1', xeroState: 'POSTED' });
  });

  it('claims and posts an original period once', async () => {
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result).toMatchObject({ outcome: 'posted', runId: 41, runKind: 'original', postedDelta: 100, xeroId: 'xero-1' });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, journalDate: '2026-06-30', buckets: [
      { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 60 },
      { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 40 },
    ] }));
    expect(mockQuery.mock.calls[0][0]).toContain("xero_state = 'POSTED'");
    expect(mockExecute.mock.calls[0][0]).toContain('breakdown_json');
  });

  it('posts only the variance as an adjustment', async () => {
    mockQuery.mockReset().mockResolvedValueOnce([{ posted_total: 80, successful_runs: 1 }]).mockResolvedValueOnce([
      { posted_delta: 80, breakdown_json: JSON.stringify([
        { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 50 },
        { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 30 },
      ]) },
    ]);
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result).toMatchObject({ outcome: 'posted', runKind: 'adjustment', postedDelta: 20 });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ amount: 20, runKind: 'adjustment' }));
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ buckets: [
      { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 10 },
      { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 10 },
    ] }));
  });

  it('blocks uncosted movements without an override reason', async () => {
    mockCalculate.mockResolvedValueOnce({ ...calculation, blocked: true, zeroCostMovementCount: 1 });
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result.outcome).toBe('blocked');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does not post when the cumulative amount is current', async () => {
    mockQuery.mockReset().mockResolvedValueOnce([{ posted_total: 100, successful_runs: 1 }]);
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result.outcome).toBe('current');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does not count a draft as posted and identifies an existing draft claim for review', async () => {
    mockQuery.mockReset().mockResolvedValueOnce([{ posted_total: 0, successful_runs: 0 }]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'success', xero_id: 'draft-1', xero_state: 'DRAFT', posted_delta: 100 }]);
    mockExecute.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result).toMatchObject({ outcome: 'already_claimed', status: 'xero_draft', xeroId: 'draft-1' });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('keeps a prior unsplit posted journal explicit in the first split adjustment', async () => {
    mockQuery.mockReset().mockResolvedValueOnce([{ posted_total: 80, successful_runs: 1 }]).mockResolvedValueOnce([
      { posted_delta: 80, breakdown_json: null },
    ]);
    await postCogsPeriod({ businessId: 'biz-1', period });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ buckets: [
      { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 60 },
      { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 40 },
      { locationId: null, locationName: 'Prior unsplit journals', channel: 'legacy', amount: -80 },
    ] }));
  });

  it('marks timeouts unknown so they are not blindly retried', async () => {
    mockSync.mockRejectedValueOnce(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result).toMatchObject({ outcome: 'unknown', runId: 41 });
    expect(mockExecute.mock.calls[1][1][0]).toBe('unknown');
  });
});