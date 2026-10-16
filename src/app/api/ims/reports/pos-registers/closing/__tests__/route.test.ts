import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), run: vi.fn(), query: vi.fn(), execute: vi.fn(), begin: vi.fn(),
  commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.guard }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({
  getConnection: async () => ({ query: mocks.query, execute: mocks.execute, beginTransaction: mocks.begin,
    commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }),
}) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { PATCH } from '../route';

const register = { id: 4, status: 'closed', opening_float: '200.00', session_date: '2026-10-16', register_name: 'Till 1', location_name: 'Sydney' };
const rows = [
  { id: 8, payment_method: 'Cash', expected_amount: '618', counted_amount: '818', xero_invoice_id: 'invoice-1' },
  { id: 9, payment_method: 'Card', expected_amount: '100', counted_amount: '100', xero_invoice_id: 'invoice-2' },
];
const entries = [
  { id: 8, previousCount: 818, expectedAmount: 618, countedAmount: '815.99' },
  { id: 9, previousCount: 100, expectedAmount: 100, countedAmount: '100' },
];
const input = { sessionId: 4, previousFloat: '200', reason: 'Verified closing sheet', acknowledgeAccounting: true, entries };
const request = (body: unknown) => new Request('http://localhost/api/ims/reports/pos-registers/closing', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockReturnValue({ user: { businessId: 'business-1', userId: 2, name: 'Alex' } });
  mocks.run.mockImplementation(async (_id, fn) => fn());
  mocks.query.mockResolvedValueOnce([[register]]).mockResolvedValueOnce([rows]);
  mocks.execute.mockResolvedValue([{ insertId: 11 }]);
});

describe('admin register closing count corrections', () => {
  it('requires admin access before tenant or database access', async () => {
    mocks.guard.mockReturnValue({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await PATCH(request(input))).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    { reason: '' }, { reason: 'x'.repeat(1001) }, { acknowledgeAccounting: false },
    { previousFloat: '-1' }, { sessionId: '4' }, { entries: [] },
    { entries: [entries[0], entries[0]] }, { entries: [{ ...entries[0], countedAmount: '1.001' }] },
    { entries: [{ ...entries[0], countedAmount: null }] }, { entries: [{ ...entries[0], expectedAmount: 'invalid' }] },
  ])('rejects invalid input before starting a transaction', async change => {
    expect((await PATCH(request({ ...input, ...change }))).status).toBe(400);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('updates only changed counts and clears only their denominations atomically with server-owned evidence', async () => {
    expect(await (await PATCH(request(input))).json()).toEqual({ success: true, correctionId: 11 });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.query.mock.calls[0][1]).toEqual([4, 'business-1']);
    expect(mocks.query.mock.calls.every(call => call[0].includes('FOR UPDATE'))).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0]).toEqual([
      'UPDATE pos_eod_reconciliations SET counted_amount = ?, denomination_data = NULL WHERE id = ? AND register_session_id = ?',
      [815.99, 8, 4],
    ]);
    const audit = mocks.execute.mock.calls[1][1];
    expect(audit.slice(0, 8)).toEqual([4, 'business-1', input.reason, 2, 'Alex', 'Till 1', 'Sydney', register.session_date]);
    expect(JSON.parse(audit[8])).toEqual([{
      id: 8, payment_method: 'Cash', previous_counted: 818, counted_amount: 815.99,
      expected_amount: 618, opening_float: 200, previous_variance: 0, variance: -2.01, xero_invoice_id: 'invoice-1',
    }]);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each([{ status: 'open' }, { opening_float: '210' }])('rejects open or stale session state', async change => {
    mocks.query.mockReset().mockResolvedValueOnce([[{ ...register, ...change }]]);
    expect((await PATCH(request(input))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not access reconciliations for another tenant or a missing session', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[]]);
    expect((await PATCH(request(input))).status).toBe(404);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it.each([
    [rows[0]], [...rows, { ...rows[0], id: 10 }],
    [{ ...rows[0], counted_amount: '819' }, rows[1]],
    [{ ...rows[0], expected_amount: '619' }, rows[1]],
    [{ ...rows[0], id: 99 }, rows[1]],
  ])('rejects stale, missing, extra or foreign reconciliation rows', async (...staleRows) => {
    mocks.query.mockReset().mockResolvedValueOnce([[register]]).mockResolvedValueOnce([staleRows]);
    expect((await PATCH(request(input))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalled();
  });
  it('rejects negative physical cash', async () => {
    expect((await PATCH(request({ ...input, entries: [{ ...entries[0], countedAmount: '-1' }, entries[1]] }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('supports negative non-cash counts for net refunds without subtracting cash float', async () => {
    expect((await PATCH(request({ ...input, entries: [{ ...entries[0], countedAmount: '818' }, { ...entries[1], countedAmount: '-20' }] }))).status).toBe(200);
    expect(JSON.parse(mocks.execute.mock.calls[1][1][8])[0]).toMatchObject({ payment_method: 'Card', opening_float: 0, variance: -120 });
  });
  it('can fill a previously unrecorded count', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[register]]).mockResolvedValueOnce([[{ ...rows[0], counted_amount: null }, rows[1]]]);
    expect((await PATCH(request({ ...input, entries: [{ ...entries[0], previousCount: null }, entries[1]] }))).status).toBe(200);
  });
  it('rejects a no-op including duplicate retries', async () => {
    expect((await PATCH(request({ ...input, entries: [{ ...entries[0], countedAmount: '818' }, entries[1]] }))).status).toBe(400);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('rolls back count changes when audit persistence fails and reports the tenant failure', async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockRejectedValueOnce(new Error('Audit insert failed'));
    expect((await PATCH(request(input))).status).toBe(500);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'correct_closing_counts' }));
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
