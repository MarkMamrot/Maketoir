import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockExecute, mockQuery, mockRunImsForBusiness, mockGetBusinessTimeZone } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));

import { GET, PUT } from '../route';

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/cogs/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/xero/cogs/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { id: 'u1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockQuery.mockResolvedValue([]);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
  });

  it('returns safe monthly defaults before configuration', async () => {
    const response = await GET(new Request('http://localhost/api/xero/cogs/settings?databaseId=biz-1'));
    const json = await response.json();
    expect(json.settings).toMatchObject({ enabled: false, frequency: 'monthly', reliableFrom: null });
  });

  it('returns when the next configured period becomes eligible', async () => {
    mockQuery.mockResolvedValueOnce([{
      enabled: 1,
      frequency: 'monthly',
      timezone: 'Australia/Sydney',
      reliable_from: '2026-07-01',
      next_period_start: '2026-08-01',
      next_run_at: null,
      held_reason: null,
      held_period_start: null,
      held_run_id: null,
      held_at: null,
      updated_at: '2026-08-04',
    }]);

    const response = await GET(new Request('http://localhost/api/xero/cogs/settings?databaseId=biz-1'));
    const json = await response.json();

    expect(json.settings).toMatchObject({
      nextPeriodStart: '2026-08-01',
      nextEligibleDate: '2026-09-01',
    });
  });

  it('requires a reliable-from date before enabling automatic sync', async () => {
    const response = await PUT(putRequest({
      databaseId: 'biz-1', enabled: true, frequency: 'monthly', timeZone: 'Australia/Sydney',
    }));
    expect(response.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('persists frequency using the timezone from General Settings', async () => {
    const response = await PUT(putRequest({
      databaseId: 'biz-1',
      enabled: true,
      frequency: 'quarterly',
      timeZone: 'Australia/Brisbane',
      reliableFrom: '2026-07-01',
    }));
    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      'biz-1', 1, 'quarterly', 'Australia/Sydney', '2026-07-01', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    ]);
  });

  it('preserves schedule progress when enabled settings are unchanged', async () => {
    mockQuery.mockResolvedValueOnce([{
      enabled: 1,
      frequency: 'daily',
      timezone: 'Australia/Sydney',
      reliable_from: '2026-07-01',
      next_period_start: '2026-07-20',
      next_run_at: null,
      updated_at: '2026-07-20',
    }]);
    const response = await PUT(putRequest({
      databaseId: 'biz-1', enabled: true, frequency: 'daily',
      timeZone: 'Australia/Sydney', reliableFrom: '2026-07-01',
    }));
    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls[0][1][5]).toBe('2026-07-20');
  });

  it('explicitly resumes a corrected blocked period', async () => {
    mockQuery.mockResolvedValueOnce([{
      enabled: 1,
      frequency: 'monthly',
      timezone: 'Australia/Sydney',
      reliable_from: '2026-07-01',
      next_period_start: '2026-07-01',
      next_run_at: null,
      held_reason: 'blocked',
      held_period_start: '2026-07-01',
      held_run_id: null,
      held_at: '2026-08-01 00:17:00',
      updated_at: '2026-08-01 00:17:00',
    }]);

    const response = await PUT(putRequest({
      databaseId: 'biz-1', enabled: true, frequency: 'monthly',
      reliableFrom: '2026-07-01', resumeHeldSchedule: true,
    }));

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[1][0]).toContain('held_reason = NULL');
    expect(mockExecute.mock.calls[1][1]).toEqual(['biz-1']);
  });

  it('does not resume an ambiguous Xero outcome', async () => {
    mockQuery.mockResolvedValueOnce([{
      enabled: 1,
      frequency: 'monthly',
      timezone: 'Australia/Sydney',
      reliable_from: '2026-07-01',
      next_period_start: '2026-07-01',
      next_run_at: null,
      held_reason: 'unknown',
      held_period_start: '2026-07-01',
      held_run_id: 42,
      held_at: '2026-08-01 00:17:00',
      updated_at: '2026-08-01 00:17:00',
    }]);

    const response = await PUT(putRequest({
      databaseId: 'biz-1', enabled: true, frequency: 'monthly',
      reliableFrom: '2026-07-01', resumeHeldSchedule: true,
    }));

    expect(response.status).toBe(409);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});