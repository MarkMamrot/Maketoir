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

import { postCogsPeriod, repostCogsRun, retryCogsRun } from '../XeroCogsService';

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

  it('keeps generic fetch failures unknown so the run cannot expose a retry action', async () => {
    mockSync.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = await postCogsPeriod({ businessId: 'biz-1', period });
    expect(result).toMatchObject({ outcome: 'unknown', runId: 41 });
    expect(mockExecute.mock.calls[1][1][0]).toBe('unknown');
  });
});

describe('retryCogsRun', () => {
  const failedRun = {
    id: 41,
    period_start: period.startDate,
    period_end: period.endDateExclusive,
    journal_date: period.journalDate,
    frequency: period.frequency,
    run_kind: 'original',
    target_amount: 100,
    posted_delta: 100,
    status: 'failed',
    xero_id: null,
    xero_state: null,
    breakdown_json: JSON.stringify([
      { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 60 },
      { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 40 },
    ]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([failedRun]);
    mockCalculate.mockResolvedValue(calculation);
    mockSync.mockResolvedValue({ journalId: 'xero-retry-1', xeroState: 'POSTED' });
    mockExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('retries an unchanged deterministic failure with its saved run identity and buckets', async () => {
    const result = await retryCogsRun({ businessId: 'biz-1', runId: 41 });
    expect(result).toEqual({ outcome: 'posted', runId: 41, xeroId: 'xero-retry-1', xeroState: 'POSTED' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ? AND business_id = ?'), [41, 'biz-1']);
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', runId: 41, amount: 100,
      buckets: [
        { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 60 },
        { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 40 },
      ],
    }));
  });

  it('does not replay a failed payload after current COGS changes', async () => {
    mockCalculate.mockResolvedValueOnce({ ...calculation, totalCOGS: 125 });
    const result = await retryCogsRun({ businessId: 'biz-1', runId: 41 });
    expect(result).toMatchObject({ outcome: 'changed', previousTarget: 100, currentTarget: 125 });
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('refuses unknown and successful runs', async () => {
    mockQuery.mockResolvedValueOnce([{ ...failedRun, status: 'unknown' }]);
    expect(await retryCogsRun({ businessId: 'biz-1', runId: 41 })).toMatchObject({ outcome: 'ineligible' });
    mockQuery.mockResolvedValueOnce([{ ...failedRun, status: 'success', xero_id: 'xero-1', xero_state: 'POSTED' }]);
    expect(await retryCogsRun({ businessId: 'biz-1', runId: 41 })).toMatchObject({ outcome: 'ineligible' });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('repostCogsRun', () => {
  const linkedRun = {
    id: 42, period_start: period.startDate, period_end: period.endDateExclusive, journal_date: period.journalDate,
    frequency: period.frequency, run_kind: 'original', target_amount: 90, posted_delta: 90,
    status: 'success', xero_id: 'draft-1', xero_state: 'DRAFT', breakdown_json: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValueOnce([linkedRun]).mockResolvedValueOnce([{ posted_total: 0, successful_runs: 0 }]).mockResolvedValueOnce([]);
    mockCalculate.mockResolvedValue(calculation);
    mockSync.mockResolvedValue({ journalId: 'draft-1', xeroState: 'POSTED' });
    mockExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('recalculates and updates the same linked journal before clearing the period marker', async () => {
    const result = await repostCogsRun({ businessId: 'biz-1', runId: 42 });
    expect(result).toMatchObject({ outcome: 'posted', runId: 42, xeroId: 'draft-1', postedDelta: 100 });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ existingJournalId: 'draft-1', amount: 100 }));
    expect(mockExecute.mock.calls[0][0]).toContain("status = 'success'");
    expect(mockExecute.mock.calls[1][0]).toContain('held_reason = NULL');
    expect(mockExecute.mock.calls[1][1]).toEqual(['biz-1', period.startDate]);
  });

  it('creates an idempotent replacement when Xero confirms the linked journal is missing', async () => {
    mockSync.mockRejectedValueOnce(new Error('Xero request failed (404)'))
      .mockResolvedValueOnce({ journalId: 'replacement-1', xeroState: 'POSTED' });
    const result = await repostCogsRun({ businessId: 'biz-1', runId: 42 });
    expect(result).toMatchObject({ outcome: 'posted', xeroId: 'replacement-1' });
    expect(mockSync).toHaveBeenNthCalledWith(2, expect.objectContaining({ replacementForJournalId: 'draft-1' }));
    expect(mockExecute.mock.calls[0][1]).toContain('replacement-1');
    expect(mockExecute.mock.calls[0][1]).toContain('Replacement for Xero journal draft-1, which Xero confirmed was missing.');
  });

  it('does not replace a journal when live Xero verification is unavailable', async () => {
    mockSync.mockRejectedValueOnce(new Error('Xero request failed (503)'));
    expect(await repostCogsRun({ businessId: 'biz-1', runId: 42 })).toMatchObject({ outcome: 'unknown' });
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('refuses a run without a linked Xero journal', async () => {
    mockQuery.mockReset().mockResolvedValueOnce([{ ...linkedRun, xero_id: null }]);
    expect(await repostCogsRun({ businessId: 'biz-1', runId: 42 })).toMatchObject({ outcome: 'ineligible' });
    expect(mockSync).not.toHaveBeenCalled();
  });
});