import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockRunImsForBusiness, mockPostCogsPeriod, mockGetBusinessTimeZone } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockPostCogsPeriod: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: vi.fn().mockResolvedValue({ affectedRows: 1 }) }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));
vi.mock('@/services/XeroCogsService', () => ({ postCogsPeriod: mockPostCogsPeriod }));

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
});