import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute, mockRunImsForBusiness, mockPostCogsPeriod, mockGetBusinessTimeZone, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockPostCogsPeriod: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));
vi.mock('@/services/XeroCogsService', () => ({ postCogsPeriod: mockPostCogsPeriod }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { POST } from '../route';

function cronRequest(secret?: string): Request {
  return new Request('http://localhost/api/xero/cogs/cron', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/xero/cogs/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockPostCogsPeriod.mockResolvedValue({ outcome: 'posted' });
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockReportRuntimeIssue.mockResolvedValue(1);
  });

  it('rejects requests without the shared cron secret', async () => {
    const response = await POST(cronRequest());
    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('processes each configured business inside tenant context', async () => {
    mockQuery.mockResolvedValueOnce([
      { business_id: 'biz-1', frequency: 'daily', timezone: 'Australia/Sydney', reliable_from: '2020-01-01', next_period_start: null },
      { business_id: 'biz-2', frequency: 'monthly', timezone: 'Australia/Brisbane', reliable_from: '2020-01-01', next_period_start: null },
    ]);

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.processed).toBe(2);
    expect(mockRunImsForBusiness).toHaveBeenCalledTimes(2);
    expect(mockRunImsForBusiness.mock.calls.map(call => call[0])).toEqual(['biz-1', 'biz-2']);
    expect(mockPostCogsPeriod).toHaveBeenCalledTimes(2);
  });

  it('continues after one tenant fails', async () => {
    mockQuery.mockResolvedValueOnce([
      { business_id: 'biz-1', frequency: 'daily', timezone: 'Australia/Sydney', reliable_from: '2020-01-01', next_period_start: null },
      { business_id: 'biz-2', frequency: 'daily', timezone: 'Australia/Sydney', reliable_from: '2020-01-01', next_period_start: null },
    ]);
    mockRunImsForBusiness
      .mockRejectedValueOnce(new Error('tenant unavailable'))
      .mockImplementationOnce(async (_businessId, callback) => callback());

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();
    expect(json.results.map((result: { outcome: string }) => result.outcome)).toEqual(['error', 'posted']);
    expect(mockPostCogsPeriod).toHaveBeenCalledOnce();
  });

  it('catches up multiple completed periods from the persisted cursor', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const cursor = twoDaysAgo.toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' });
    mockQuery.mockResolvedValueOnce([
      { business_id: 'biz-1', frequency: 'daily', timezone: 'Australia/Sydney', reliable_from: '2020-01-01', next_period_start: cursor },
    ]);

    const response = await POST(cronRequest('test-secret'));
    expect(response.status).toBe(200);
    expect(mockPostCogsPeriod.mock.calls.length).toBeGreaterThanOrEqual(2);
    const starts = mockPostCogsPeriod.mock.calls.map(call => call[0].period.startDate);
    expect(starts[1]).toBe(mockPostCogsPeriod.mock.calls[0][0].period.endDateExclusive);
  });

  it('holds and reports a blocked period instead of advancing the cursor', async () => {
    mockQuery.mockResolvedValueOnce([
      { business_id: 'biz-1', frequency: 'monthly', reliable_from: '2020-01-01', next_period_start: '2026-07-01' },
    ]);
    mockPostCogsPeriod.mockResolvedValueOnce({
      outcome: 'blocked',
      reason: 'uncosted_movements',
      calculation: {
        includedMovementCount: 3,
        missingCostMovementCount: 1,
        zeroCostMovementCount: 0,
        orphanedMovementCount: 0,
      },
    });

    const response = await POST(cronRequest('test-secret'));
    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute.mock.calls[0][0]).toContain('held_reason');
    expect(mockExecute.mock.calls[0][1]).toEqual(['blocked', '2026-07-01', null, 'biz-1']);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'cogs_cron_period_held',
      severity: 'warning',
      reference: { type: 'cogs_period', id: 'monthly:2026-07-01:2026-08-01' },
    }));
  });

  it('does not select schedules that are already held', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await POST(cronRequest('test-secret'));

    expect(mockQuery.mock.calls[0][0]).toContain('s.held_reason IS NULL');
    expect(mockPostCogsPeriod).not.toHaveBeenCalled();
  });
});