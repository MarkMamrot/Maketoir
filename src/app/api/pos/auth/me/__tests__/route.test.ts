import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookieSet, mockGetAdminSession, mockGetPosSession, mockGetImsSession, mockImsQuery } = vi.hoisted(() => ({
  mockCookieSet: vi.fn(),
  mockGetAdminSession: vi.fn(),
  mockGetPosSession: vi.fn(),
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ set: mockCookieSet }) }));
vi.mock('@/lib/sessionUtils', () => ({
  getAdminSession: mockGetAdminSession,
  getPosSession: mockGetPosSession,
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { GET } from '../route';

describe('GET /api/pos/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReturnValue(null);
    mockGetPosSession.mockReturnValue(null);
  });

  it('replaces a stale POS session with the active admin business', async () => {
    mockGetAdminSession.mockReturnValue({
      businessId: 'sandbox', email: 'admin@example.com', name: 'Admin', tier: 'Admin',
    });
    mockGetPosSession.mockReturnValue({ businessId: 'monsterthreads', location_id: 7 });
    mockImsQuery.mockResolvedValue([{ name: 'Sandbox Shop', business_id: 'sandbox' }]);

    const response = await GET(new Request('http://localhost/api/pos/auth/me?location_id=3&business_id=sandbox'));
    const body = await response.json();

    expect(mockGetImsSession).toHaveBeenCalledWith(['marketoir_session']);
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), [3, 'sandbox']);
    expect(body.session).toMatchObject({ businessId: 'sandbox', location_id: 3, location_name: 'Sandbox Shop' });
    expect(mockCookieSet).toHaveBeenCalledWith('pos_session', expect.stringContaining('"businessId":"sandbox"'), expect.objectContaining({ path: '/' }));
  });

  it('clears the stale POS cookie when the device belongs to another business', async () => {
    mockGetAdminSession.mockReturnValue({ businessId: 'sandbox' });
    mockGetPosSession.mockReturnValue({ businessId: 'monsterthreads', location_id: 7 });

    const response = await GET(new Request('http://localhost/api/pos/auth/me?location_id=7&business_id=monsterthreads'));

    expect(await response.json()).toEqual({ session: null, device_mismatch: true });
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockCookieSet).toHaveBeenCalledWith('pos_session', '', { maxAge: 0, path: '/' });
  });

  it('rejects a cashier session that does not match the configured device', async () => {
    mockGetPosSession.mockReturnValue({ businessId: 'monsterthreads', location_id: 7 });

    const response = await GET(new Request('http://localhost/api/pos/auth/me?location_id=3&business_id=sandbox'));

    expect(await response.json()).toEqual({ session: null, device_mismatch: true });
    expect(mockGetImsSession).not.toHaveBeenCalled();
  });
});