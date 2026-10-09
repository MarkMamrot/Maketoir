import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), calculate: vi.fn(), imsQuery: vi.fn(), xeroFetch: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.xeroFetch }));
vi.mock('@/lib/xero/cogsCalculator', () => ({ calculateCogsForPeriod: mocks.calculate }));
import { journalHref, loadPostingReconciliations, summarisePostingRuns, type PostingRun } from '../postings';
import { parseRequest } from '../request';

const run: PostingRun = { id: 1, from: '2026-09-01', toExclusive: '2026-10-01', journalDate: '2026-09-30',
  frequency: 'monthly', kind: 'original', target: 100, amount: 100, status: 'success', xeroId: 'journal-1',
  xeroStatus: 'POSTED', recordedAt: '2026-10-02 04:00:00', updatedAt: '2026-10-02 04:00:00', missingCosts: 0, zeroCosts: 0,
  errorDetail: null, overrideReason: null,
  buckets: [{ locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 100 }] };

describe('COGS posting reconciliation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([run]); mocks.imsQuery.mockResolvedValue([]); mocks.calculate.mockResolvedValue({ totalCOGS: 120, blocked: false, breakdown: [] }); mocks.xeroFetch.mockResolvedValue({ ManualJournals: [{ Status: 'POSTED' }] }); });
  it('sums signed original and adjustment journals, excluding drafts and voids', () => {
    expect(summarisePostingRuns([run, { ...run, id: 2, kind: 'adjustment', amount: -20 },
      { ...run, id: 3, amount: 40, xeroStatus: 'DRAFT' }, { ...run, id: 4, xeroStatus: 'VOIDED' }]))
      .toMatchObject({ postedTotal: 80, draftTotal: 40, postedCount: 2, draftCount: 1, voidedCount: 1 });
  });
  it('does not treat missing journal IDs or unknown states as posted', () => {
    expect(summarisePostingRuns([{ ...run, xeroStatus: null }, { ...run, xeroId: null }, { ...run, status: 'unknown' }]))
      .toMatchObject({ postedTotal: 0, uncertainCount: 3 });
  });
  it('uses the stable Xero entry point instead of the unavailable legacy journal route', () => {
    expect(journalHref(null)).toBeNull();
    expect(journalHref('id&unsafe=1')).toBe('https://go.xero.com/');
  });
  it('uses tenant-filtered SELECTs and the entire accounting period rather than the selected partial range', async () => {
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams('from=2026-09-15&to=2026-10-07')));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ?'), ['tenant-1', '2026-10-08', '2026-09-15']);
    expect(mocks.query.mock.calls[0][0]).toMatch(/^SELECT/);
    expect(mocks.calculate).toHaveBeenCalledWith({ businessId: 'tenant-1', startDate: '2026-09-01', endDateExclusive: '2026-10-01' });
    expect(result.rows[0]).toMatchObject({ postedTotal: 100, variance: 20, state: 'Difference to review' });
    expect(result.rows[0].runs[0].href).toBe('https://go.xero.com/');
  });
  it('returns the immutable line-item snapshot stored with the actual run', async () => {
    mocks.query.mockResolvedValue([{ ...run, breakdownJson: JSON.stringify(run.buckets), buckets: undefined }]);
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()));
    expect(result.rows[0].runs[0].buckets).toEqual([{ locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 100 }]);
    expect(mocks.query.mock.calls[0][0]).toContain('breakdown_json AS breakdownJson');
  });
  it('uses a live Xero status and posted total when provider verification completes', async () => {
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()), { verifyXero: true });
    expect(mocks.xeroFetch).toHaveBeenCalledWith('tenant-1', '/ManualJournals/journal-1', { method: 'GET' });
    expect(result.rows[0]).toMatchObject({ liveVerificationComplete: true, livePostedTotal: 100, liveVariance: 20 });
    expect(result.rows[0].runs[0]).toMatchObject({ liveXeroStatus: 'POSTED', liveVerification: 'verified' });
  });
  it('does not let a stale recorded Draft block a journal Xero verifies as Posted', async () => {
    mocks.query.mockResolvedValue([{ ...run, xeroStatus: 'DRAFT' }]);
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()), { verifyXero: true });
    expect(result.rows[0]).toMatchObject({ postedCount: 1, postedTotal: 100, draftCount: 0, draftTotal: 0,
      liveVerificationComplete: true, livePostedTotal: 100 });
  });
  it('does not disguise an unavailable live Xero check as verified evidence', async () => {
    mocks.xeroFetch.mockRejectedValue(new Error('Xero unavailable'));
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()), { verifyXero: true });
    expect(result.rows[0]).toMatchObject({ liveVerificationComplete: false, livePostedTotal: null, state: 'Live Xero verification unavailable' });
    expect(result.rows[0].runs[0]).toMatchObject({ liveVerification: 'unavailable', liveXeroStatus: null });
  });
  it('reports when Xero confirms that the linked journal does not exist', async () => {
    mocks.xeroFetch.mockRejectedValue(new Error('Xero API GET /ManualJournals/journal-1 failed (404): not found'));
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()), { verifyXero: true });
    expect(result.rows[0]).toMatchObject({ liveVerificationComplete: false, livePostedTotal: null, state: 'Linked Xero journal not found' });
    expect(result.rows[0].runs[0]).toMatchObject({ liveVerification: 'not_found', liveXeroStatus: 'NOT_FOUND' });
  });
  it('keeps all runs for a period together across pagination', async () => {
    mocks.query.mockResolvedValue([{ ...run, id: 2, kind: 'adjustment', amount: 20 }, run,
      { ...run, id: 3, from: '2026-08-01', toExclusive: '2026-09-01' }]);
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams('from=2026-08-01&to=2026-10-07&pageSize=1')));
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ postedTotal: 120, variance: 0 });
    expect(result.rows[0].runs).toHaveLength(2);
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
  });
  it('shows unconfigured history without creating tables', async () => {
    mocks.query.mockRejectedValue({ code: 'ER_NO_SUCH_TABLE' });
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()));
    expect(result).toMatchObject({ tableAvailable: false, total: 0, rows: [] });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.calculate).not.toHaveBeenCalled();
  });
  it('reads legacy posting history before the snapshot migration without attempting schema writes', async () => {
    mocks.query.mockRejectedValueOnce({ code: 'ER_BAD_FIELD_ERROR' }).mockResolvedValueOnce([run]);
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()));
    expect(result.rows[0].runs[0].buckets).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.query.mock.calls[1][0]).toContain('NULL AS breakdownJson');
    expect(mocks.query.mock.calls.every(call => String(call[0]).startsWith('SELECT'))).toBe(true);
  });

  it('shows completed configured periods with no runs and identifies an earlier schedule hold', async () => {
    mocks.query.mockImplementation((sql: string) => sql.includes('FROM xero_cogs_settings') ? Promise.resolve([{
      frequency: 'monthly', timezone: 'Australia/Sydney', reliable_from: '2026-07-01',
      held_reason: 'failed', held_period_start: '2026-07-01', held_run_id: 1,
    }]) : Promise.resolve([{ ...run, from: '2026-07-01', toExclusive: '2026-08-01', journalDate: '2026-07-31' }]));
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams('from=2026-07-01&to=2026-10-09')));
    expect(result.rows.map(period => period.from)).toEqual(['2026-09-01', '2026-08-01', '2026-07-01']);
    expect(result.rows[0]).toMatchObject({ state: 'Not posted - earlier period unresolved', blockedByPriorHold: true, runs: [] });
    expect(result.rows[1]).toMatchObject({ state: 'Not posted - earlier period unresolved', blockedByPriorHold: true, runs: [] });
    expect(result.rows[2]).toMatchObject({ scheduleHold: { reason: 'failed', runId: 1 } });
  });
  it('does not disguise an operational failure as an empty ledger', async () => {
    mocks.query.mockRejectedValue({ code: 'ECONNREFUSED' });
    await expect(loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
  it('refuses silent history truncation', async () => {
    mocks.query.mockResolvedValue(Array(50001).fill(run));
    await expect(loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()))).rejects.toThrow('no runs have been truncated');
    expect(mocks.calculate).not.toHaveBeenCalled();
  });
  it('prioritises incomplete costs and uncertain posting evidence over a numerical match', async () => {
    mocks.calculate.mockResolvedValue({ totalCOGS: 100, blocked: true, breakdown: [] });
    const request = parseRequest(new URLSearchParams());
    expect((await loadPostingReconciliations('tenant-1', request)).rows[0].state).toBe('Posting blocked by incomplete costs');
    mocks.query.mockResolvedValue([run, { ...run, id: 2, status: 'unknown' }]);
    expect((await loadPostingReconciliations('tenant-1', request)).rows[0].state).toBe('Status uncertain');
  });
  it('resolves tenant location names once, retaining separate channel buckets and unchanged financial totals', async () => {
    mocks.calculate.mockResolvedValue({ totalCOGS: 120, blocked: false, breakdown: [
      { locationId: 1, channel: 'pos', totalCOGS: 50, movementCount: 10, quantity: 10 },
      { locationId: 1, channel: 'online', totalCOGS: 30, movementCount: 5, quantity: 5 },
      { locationId: 2, channel: 'pos', totalCOGS: 40, movementCount: 8, quantity: 8 },
    ] });
    mocks.imsQuery.mockResolvedValue([{ id: 1, name: 'Newtown' }, { id: 2, name: 'Warehouse' }]);
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()));
    expect(mocks.imsQuery).toHaveBeenCalledExactlyOnceWith('SELECT id, name FROM ims_locations WHERE id IN (?,?)', [1, 2]);
    expect(result.rows[0].calculation.breakdown.map(bucket => bucket.locationName)).toEqual(['Newtown', 'Newtown', 'Warehouse']);
    expect(result.rows[0]).toMatchObject({ calculation: { totalCOGS: 120 }, postedTotal: 100, variance: 20 });
  });
  it('marks missing or deleted location names explicitly without inventing a name', async () => {
    mocks.calculate.mockResolvedValue({ totalCOGS: 120, blocked: false, breakdown: [
      { locationId: 77, channel: 'pos', totalCOGS: 120, movementCount: 1, quantity: 1 },
      { locationId: 0, channel: 'returns', totalCOGS: 0, movementCount: 1, quantity: 1 },
    ] });
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()));
    expect(mocks.imsQuery).toHaveBeenCalledWith(expect.any(String), [77]);
    expect(result.rows[0].calculation.breakdown.map(bucket => bucket.locationName)).toEqual(['Location name unavailable (ID 77)', 'Location not recorded']);
  });
  it('surfaces location lookup failures rather than silently reverting to numbered labels', async () => {
    mocks.calculate.mockResolvedValue({ totalCOGS: 120, blocked: false, breakdown: [{ locationId: 1, channel: 'pos' }] });
    mocks.imsQuery.mockRejectedValue(new Error('Location lookup unavailable'));
    await expect(loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams()))).rejects.toThrow('Location lookup unavailable');
  });
});