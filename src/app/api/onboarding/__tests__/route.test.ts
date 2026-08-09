import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  query: vi.fn(),
  getBusinessInfo: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/db/BusinessInfoRepository', () => ({
  BusinessInfoRepository: { get: mocks.getBusinessInfo, upsert: vi.fn() },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportIssue }));

import { GET } from '../route';

describe('GET /api/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.query.mockResolvedValue([{ c: 1 }]);
    mocks.getBusinessInfo.mockResolvedValue(null);
    mocks.reportIssue.mockResolvedValue(1);
    mocks.imsQuery.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT `key`, value') ? [] : [{ c: 0 }]),
    );
  });

  it('returns a valid onboarding state when tenant tables are empty', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.counts).toEqual({
      users: 1,
      locations: 0,
      products: 0,
      salesOrders: 0,
      purchaseOrders: 0,
      stockRows: 0,
    });
    expect(mocks.reportIssue).not.toHaveBeenCalled();
  });

  it('reports database failures instead of presenting them as zero data', async () => {
    const databaseError = new Error('Table does not exist');
    mocks.imsQuery.mockRejectedValue(databaseError);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Onboarding progress could not be loaded.' });
    expect(mocks.reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      source: 'onboarding',
      operation: 'load_progress',
      error: databaseError,
    }));
  });
});