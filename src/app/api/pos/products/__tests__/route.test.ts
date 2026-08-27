import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAdminSession, mockGetPosSession, mockGetImsSession, mockImsQuery } = vi.hoisted(() => ({
  mockGetAdminSession: vi.fn(),
  mockGetPosSession: vi.fn(),
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  getAdminSession: mockGetAdminSession,
  getPosSession: mockGetPosSession,
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn().mockResolvedValue('Australia/Sydney') }));

import { GET } from '../route';

describe('GET /api/pos/products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReturnValue(null);
    mockGetPosSession.mockReturnValue(null);
    mockImsQuery.mockResolvedValue([]);
  });

  it('uses the verified admin business instead of a stale POS session', async () => {
    mockGetAdminSession.mockReturnValue({ businessId: 'sandbox' });
    mockGetPosSession.mockReturnValue({ businessId: 'monsterthreads', location_id: 7 });

    const response = await GET(new Request('http://localhost/api/pos/products?location_id=3'));
    const [, params] = mockImsQuery.mock.calls[0];

    expect(response.status).toBe(200);
    expect(mockGetImsSession).toHaveBeenCalledWith(['marketoir_session']);
    expect(params).toEqual([3, 'sandbox']);
  });

  it('retains cashier location fencing without an admin session', async () => {
    mockGetPosSession.mockReturnValue({ businessId: 'monsterthreads', location_id: 7 });

    const response = await GET(new Request('http://localhost/api/pos/products?location_id=3'));

    expect(response.status).toBe(403);
    expect(mockImsQuery).not.toHaveBeenCalled();
  });
});