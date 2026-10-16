import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(), run: vi.fn(), query: vi.fn(), execute: vi.fn(), begin: vi.fn(),
  commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), recipients: vi.fn(), send: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.guard }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({
  getConnection: async () => ({ query: mocks.query, execute: mocks.execute, beginTransaction: mocks.begin,
    commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }),
}) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ getXeroReconciliationRecipients: mocks.recipients }));
vi.mock('@/lib/xero/reconciliation/email', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/xero/reconciliation/email')>(), sendReconciliationEmail: mocks.send,
}));
import { PATCH, POST } from '../route';
const register = { id: 4, status: 'open', opening_float: '200.00', session_date: '2026-10-14', register_name: 'Till 1', location_name: 'Sydney' };
const correction = { id: 9, session_status: 'closed', email_sent_at: null, register_name: 'Till 1', location_name: 'Sydney',
  session_date: '2026-10-14', previous_float: '200', opening_float: '250', actor_name: 'Alex', reason: 'Opening count corrected',
  created_at: '2026-10-14 10:00:00', cash_snapshot: '[]' };
const input = { sessionId: 4, status: 'open', previousFloat: '200', openingFloat: '250', reason: 'Opening count corrected' };
const request = (body: unknown, method = 'PATCH') => new Request('http://localhost/api/ims/reports/pos-registers/float', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockReturnValue({ user: { businessId: 'business-1', tier: 'Admin', userId: 2, name: 'Alex' } });
  mocks.run.mockImplementation(async (_id, fn) => fn());
  mocks.query.mockResolvedValueOnce([[register]]).mockResolvedValueOnce([[
    { id: 8, expected_amount: '618', counted_amount: '818', opening_float: '200', xero_invoice_id: 'inv-1' },
  ]]);
  mocks.execute.mockResolvedValue([{ insertId: 9 }]);
  mocks.recipients.mockResolvedValue(['accounts@example.com']);
  mocks.send.mockResolvedValue('message-1');
});
describe('register float correction API', () => {
  it.each([PATCH, POST])('requires admin tier before database access', async handler => {
    mocks.guard.mockReturnValue({ response: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) });
    expect((await handler(request(input))).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([{ openingFloat: '-1' }, { openingFloat: '1.001' }, { reason: '' }, { sessionId: -1 }, { status: 'invalid' }])('validates input', async change => {
    expect((await PATCH(request({ ...input, ...change }))).status).toBe(400);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('atomically corrects session and cash reconciliation with audit evidence, without syncing accounting', async () => {
    const response = await PATCH(request(input));
    expect(await response.json()).toEqual({ success: true, correctionId: 9 });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.query.mock.calls[0][1]).toEqual([4, 'business-1']);
    expect(mocks.execute.mock.calls[0][1]).toEqual([250, 4]);
    expect(mocks.execute.mock.calls[1][0]).toContain("LOWER(TRIM(payment_method)) = 'cash'");
    const audit = mocks.execute.mock.calls[2][1];
    expect(JSON.parse(audit.at(-1))[0]).toMatchObject({ counted: 818, expected: 618, variance: -50, previousVariance: 0, xeroInvoiceId: 'inv-1' });
    expect(mocks.execute.mock.calls.map(call => call[0]).join(' ')).not.toMatch(/SET.*xero_/);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each(['closed', 'changed-float'])('rejects stale session %s', async kind => {
    mocks.query.mockReset().mockResolvedValue([[{ ...register, ...(kind === 'closed' ? { status: 'closed' } : { opening_float: '220' }) }]]);
    expect((await PATCH(request(input))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalled();
  });
  it('rejects another tenant or missing register', async () => {
    mocks.query.mockReset().mockResolvedValue([[]]);
    expect((await PATCH(request(input))).status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects closed-register float edits', async () => {
    mocks.query.mockReset().mockResolvedValue([[{ ...register, status: 'closed' }]]);
    expect((await PATCH(request({ ...input, status: 'closed' }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects closed float corrections even with accounting acknowledgement', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[{ ...register, status: 'closed' }]]).mockResolvedValueOnce([[]]);
    expect((await PATCH(request({ ...input, status: 'closed', acknowledgeAccounting: true }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('rolls back both amounts if audit persistence fails and reports the runtime issue', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('DB failed'));
    expect((await PATCH(request(input))).status).toBe(500);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'correct_float' }));
  });
  it('emails server-owned correction evidence using configured accounts recipients', async () => {
    mocks.query.mockReset().mockResolvedValue([[correction]]);
    expect((await POST(request({ correctionId: 9, openingFloat: '999', recipients: ['attacker@example.com'] }, 'POST'))).status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual([9, 'business-1']);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ['accounts@example.com'], idempotencyKey: 'register-float-business-1-9',
      html: expect.stringContaining('$200.00 -&gt; $250.00'),
    }));
    expect(mocks.execute.mock.calls[0][0]).toContain('email_sent_at');
  });
  it('does not resend a persisted sent notice', async () => {
    mocks.query.mockReset().mockResolvedValue([[{ ...correction, email_sent_at: '2026-10-14 10:01:00' }]]);
    expect(await (await POST(request({ correctionId: 9 }, 'POST'))).json()).toEqual({ success: true, alreadySent: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps the correction saved on email failure and surfaces a retryable error', async () => {
    mocks.query.mockReset().mockResolvedValue([[correction]]);
    mocks.send.mockRejectedValue(new Error('Provider failed'));
    const response = await POST(request({ correctionId: 9 }, 'POST'));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('remains saved');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'email_bookkeeper' }));
  });
  it('blocks email when recipients are unconfigured', async () => {
    mocks.query.mockReset().mockResolvedValue([[correction]]);
    mocks.recipients.mockResolvedValue([]);
    expect((await POST(request({ correctionId: 9 }, 'POST'))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not email open-session corrections', async () => {
    mocks.query.mockReset().mockResolvedValue([[{ ...correction, session_status: 'open' }]]);
    expect((await POST(request({ correctionId: 9 }, 'POST'))).status).toBe(404);
  });
});
