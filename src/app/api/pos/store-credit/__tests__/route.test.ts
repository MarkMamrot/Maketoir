import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookiesGet, mockGetImsSession, mockImsQuery, mockGetIMSPool, mockGetConnection, mockExecute, mockRelease } = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockGetIMSPool: vi.fn(),
  mockGetConnection: vi.fn(),
  mockExecute: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookiesGet }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
  getIMSPool: mockGetIMSPool,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('@/services/XeroSyncService', () => ({ syncStoreCreditRedemptionReclass: vi.fn() }));

import { GET, PUT } from '../route';

describe('GET /api/pos/store-credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesGet.mockReturnValue({ value: JSON.stringify({ businessId: 'sage-business', location_id: 4, tier: 'PosUser' }) });
    mockGetImsSession.mockResolvedValue({ businessId: 'sage-business' });
    mockGetConnection.mockResolvedValue({ execute: mockExecute, release: mockRelease });
    mockGetIMSPool.mockReturnValue({ getConnection: mockGetConnection });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('searches active customer contacts in the current business by maintained name or phone', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, name: 'Acme Retail', first_name: 'Ava', last_name: 'Chen', phone: '0412 345 678', store_credit: '12.50' }])
      .mockResolvedValueOnce([{ count: 2 }]);

    const response = await GET(new Request('http://localhost/api/pos/store-credit?q=0412'));
    const [sql, params] = mockImsQuery.mock.calls[0];

    expect(sql).toContain("type IN ('retail_customer', 'b2b_customer', 'both')");
    expect(sql).toContain('business_id = ?');
    expect(sql).toContain('is_active = 1');
    expect(sql).not.toContain('deleted_at');
    expect(sql).toContain('name LIKE ?');
    expect(sql).toContain("REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', '')");
    expect(params).toEqual([...Array(7).fill('%0412%'), 'sage-business']);
    expect(await response.json()).toEqual({
      contacts: [{ id: 7, name: 'Acme Retail', email: null, phone: '0412 345 678', store_credit: 12.5, is_active: true }],
      inactiveCount: 2,
    });
  });

  it('returns inactive matches only when explicitly requested', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 9, name: 'Old Customer', email: 'old@example.com', phone: null, store_credit: 0 }]);
    const response = await GET(new Request('http://localhost/api/pos/store-credit?q=old&include_inactive=1'));
    const [sql] = mockImsQuery.mock.calls[0];

    expect(sql).toContain('is_active = 0');
    expect(mockImsQuery).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ contacts: [{ id: 9, is_active: false }], inactiveCount: 0 });
  });

  it('allows authenticated POS staff to reactivate a tenant customer without manager approval', async () => {
    const response = await PUT(new Request('http://localhost/api/pos/store-credit', { method: 'PUT', body: JSON.stringify({ contact_id: 9 }) }));

    expect(response.status).toBe(200);
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('business_id = ?');
    expect(sql).toContain("type IN ('retail_customer', 'b2b_customer', 'both')");
    expect(params).toEqual([9, 'sage-business']);
  });

  it('rejects reactivation when the tenant session does not match the POS session', async () => {
    mockGetImsSession.mockResolvedValue({ businessId: 'other-business' });
    const response = await PUT(new Request('http://localhost/api/pos/store-credit', { method: 'PUT', body: JSON.stringify({ contact_id: 9, manager_pin: '1234' }) }));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});