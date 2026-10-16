import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), query: vi.fn(), connection: vi.fn(), execute: vi.fn(),
  begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, getPool: () => ({ getConnection: mocks.connection }) }));
import { GET, PATCH } from '../route';

const context = { params: { id: 'business-1' } };
const entry = { month: '2026-01', paymentPlan: 'Core monthly', amountAud: '149.50', paid: true, revision: 0 };
function request(body: unknown) {
  return new Request('http://localhost/api/admin/businesses/business-1/billing', { method: 'PATCH', body: JSON.stringify(body) });
}
function update(entries: unknown[] = [entry]) {
  return request({ planStartDate: '2026-01-15', expectedPlanStartDate: null, entries });
}

describe('SuperAdmin manual business billing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { userId: 7, tier: 'SuperAdmin' } });
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM businesses') ? [{ planStartDate: null }] : []);
    mocks.connection.mockResolvedValue({
      execute: mocks.execute, beginTransaction: mocks.begin, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    });
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM businesses')) return [[{ planStartDate: null }]];
      return [[]];
    });
  });

  it('requires SuperAdmin access before any billing reads or writes', async () => {
    mocks.auth.mockReturnValue({ response: new Response('Forbidden', { status: 403 }) });
    expect((await GET(request(null), context)).status).toBe(403);
    expect((await PATCH(update(), context)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.connection).not.toHaveBeenCalled();
  });
  it('loads only the selected business and preserves zero-dollar paid records', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM businesses')
      ? [{ planStartDate: '2026-01-15' }]
      : [{ billing_month: '2026-01', payment_plan: 'Complimentary', amount_cents: '0', is_paid: 1, revision: 2 }]);
    const response = await GET(request(null), context);
    expect(await response.json()).toEqual({
      success: true, billing: { planStartDate: '2026-01-15', entries: [{ month: '2026-01', paymentPlan: 'Complimentary', amountAud: '0.00', paid: true, revision: 2 }] },
    });
    expect(mocks.query.mock.calls.every(([, values]) => values[0] === 'business-1')).toBe(true);
  });
  it('saves exact cents, manual paid status and actor in a single transaction', async () => {
    const response = await PATCH(update(), context);
    expect(response.status).toBe(200);
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO business_billing_months'),
      ['business-1', '2026-01', 'Core monthly', 14950, 1, 7, 7]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE businesses SET plan_start_date'), ['2026-01-15', 'business-1']);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('does not fabricate monthly records when only saving the start date', async () => {
    expect((await PATCH(update([]), context)).status).toBe(200);
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO business_billing_months'))).toBe(false);
  });
  it.each([
    { entries: [{ ...entry, amountAud: '-1' }] }, { entries: [{ ...entry, amountAud: '1.999' }] },
    { entries: [{ ...entry, paymentPlan: '' }] }, { entries: [{ ...entry, paid: 'yes' }] }, { entries: [entry, entry] },
  ])('validates payment records before opening a transaction: $entries', async ({ entries }) => {
    expect((await PATCH(update(entries), context)).status).toBe(400);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('rejects changed monthly records without overwriting them', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM businesses')) return [[{ planStartDate: null }]];
      if (sql.includes('SELECT revision')) return [[{ revision: 2 }]];
      return [[]];
    });
    const response = await PATCH(update(), context);
    expect(response.status).toBe(409);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
  });
  it('rejects a concurrently changed start date', async () => {
    mocks.execute.mockResolvedValue([[{ planStartDate: '2026-02-01' }]]);
    expect((await PATCH(update(), context)).status).toBe(409);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it('edits an existing historical month without changing its identity or losing an explicit unpaid status', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM businesses')) return [[{ planStartDate: null }]];
      if (sql.includes('SELECT revision')) return [[{ revision: 2 }]];
      return [[]];
    });
    const response = await PATCH(request({
      planStartDate: null, expectedPlanStartDate: null, entries: [{ ...entry, paid: false, revision: 2 }],
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('revision = revision + 1'),
      ['business-1', '2026-01', 'Core monthly', 14950, 0, 7, 7]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it('does not add records before the plan starts or without a plan date', async () => {
    expect((await PATCH(request({ planStartDate: null, expectedPlanStartDate: null, entries: [entry] }), context)).status).toBe(400);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('rolls back and records operational database failures', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await PATCH(update(), context)).status).toBe(500);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'save_monthly_history' }));
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('reports a missing schema instead of returning empty history', async () => {
    mocks.query.mockRejectedValue(new Error('Missing billing table'));
    expect((await GET(request(null), context)).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'load_monthly_history' }));
  });
  it('returns not found for an unavailable business', async () => {
    mocks.query.mockResolvedValue([]);
    expect((await GET(request(null), context)).status).toBe(404);
  });
});
