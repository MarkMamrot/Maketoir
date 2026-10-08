import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), calculate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/xero/cogsCalculator', () => ({ calculateCogsForPeriod: mocks.calculate }));
import { journalHref, loadPostingReconciliations, summarisePostingRuns, type PostingRun } from '../postings';
import { parseRequest } from '../request';

const run: PostingRun = { id: 1, from: '2026-09-01', toExclusive: '2026-10-01', journalDate: '2026-09-30',
  frequency: 'monthly', kind: 'original', target: 100, amount: 100, status: 'success', xeroId: 'journal-1',
  xeroStatus: 'POSTED', recordedAt: '2026-10-02 04:00:00', updatedAt: '2026-10-02 04:00:00', missingCosts: 0, zeroCosts: 0 };

describe('COGS posting reconciliation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([run]); mocks.calculate.mockResolvedValue({ totalCOGS: 120, blocked: false, breakdown: [] }); });
  it('sums signed original and adjustment journals, excluding drafts and voids', () => {
    expect(summarisePostingRuns([run, { ...run, id: 2, kind: 'adjustment', amount: -20 },
      { ...run, id: 3, amount: 40, xeroStatus: 'DRAFT' }, { ...run, id: 4, xeroStatus: 'VOIDED' }]))
      .toMatchObject({ postedTotal: 80, draftTotal: 40, postedCount: 2, draftCount: 1, voidedCount: 1 });
  });
  it('does not treat missing journal IDs or unknown states as posted', () => {
    expect(summarisePostingRuns([{ ...run, xeroStatus: null }, { ...run, xeroId: null }, { ...run, status: 'unknown' }]))
      .toMatchObject({ postedTotal: 0, uncertainCount: 3 });
  });
  it('builds only fixed-host, encoded Xero journal links', () => {
    expect(journalHref(null)).toBeNull();
    expect(journalHref('id&unsafe=1')).toBe('https://go.xero.com/ManualJournals/View.aspx?manualJournalID=id%26unsafe%3D1');
  });
  it('uses tenant-filtered SELECTs and the entire accounting period rather than the selected partial range', async () => {
    const result = await loadPostingReconciliations('tenant-1', parseRequest(new URLSearchParams('from=2026-09-15&to=2026-10-07')));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ?'), ['tenant-1', '2026-10-08', '2026-09-15']);
    expect(mocks.query.mock.calls[0][0]).toMatch(/^SELECT/);
    expect(mocks.calculate).toHaveBeenCalledWith({ businessId: 'tenant-1', startDate: '2026-09-01', endDateExclusive: '2026-10-01' });
    expect(result.rows[0]).toMatchObject({ postedTotal: 100, variance: 20, state: 'Difference to review' });
    expect(result.rows[0].runs[0].href).toContain('manualJournalID=journal-1');
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
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.calculate).not.toHaveBeenCalled();
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
    expect((await loadPostingReconciliations('tenant-1', request)).rows[0].state).toBe('Cost checks blocked');
    mocks.query.mockResolvedValue([run, { ...run, id: 2, status: 'unknown' }]);
    expect((await loadPostingReconciliations('tenant-1', request)).rows[0].state).toBe('Status uncertain');
  });
});