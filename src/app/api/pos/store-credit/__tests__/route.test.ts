import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookiesGet, mockGetImsSession, mockImsQuery } = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookiesGet }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
  getIMSPool: vi.fn(),
}));
vi.mock('@/services/XeroSyncService', () => ({ syncStoreCreditRedemptionReclass: vi.fn() }));

import { GET } from '../route';

describe('GET /api/pos/store-credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesGet.mockReturnValue({ value: JSON.stringify({ businessId: 'sage-business' }) });
    mockGetImsSession.mockResolvedValue({ businessId: 'sage-business' });
  });

  it('searches active retail customers by maintained name or phone', async () => {
    mockImsQuery.mockResolvedValue([
      { id: 7, name: 'Acme Retail', first_name: 'Ava', last_name: 'Chen', phone: '0412 345 678', store_credit: '12.50' },
    ]);

    const response = await GET(new Request('http://localhost/api/pos/store-credit?q=0412'));
    const [sql, params] = mockImsQuery.mock.calls[0];

    expect(sql).toContain("type = 'retail_customer'");
    expect(sql).toContain('is_active = 1');
    expect(sql).toContain('name LIKE ?');
    expect(sql).toContain("REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', '')");
    expect(params).toEqual(Array(7).fill('%0412%'));
    expect(await response.json()).toEqual({
      contacts: [{ id: 7, name: 'Acme Retail', email: null, phone: '0412 345 678', store_credit: 12.5 }],
    });
  });
});