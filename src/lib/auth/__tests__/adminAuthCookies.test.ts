import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSession } from '@/lib/sessionUtils';

const mocks = vi.hoisted(() => ({ set: vi.fn(), sign: vi.fn(() => 'signed-session') }));
vi.mock('next/headers', () => ({ cookies: () => ({ set: mocks.set }) }));
vi.mock('@/lib/auth/adminSessionToken', () => ({
  ADMIN_SESSION_MAX_AGE_SECONDS: 28800, signAdminSession: mocks.sign,
}));
import { setAdminSessionCookie } from '../adminAuthCookies';

const session: AdminSession = {
  userId: 42, name: 'Morgan', email: 'morgan@example.com', businessId: 'business-a', tier: 'Admin', company: 'Example', role: 'admin',
};

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('platform session lifetime', () => {
  it.each([undefined, 99999])('preserves the eight-hour maximum', requested => {
    setAdminSessionCookie(session, requested);
    expect(mocks.sign).toHaveBeenCalledWith(session, { maxAgeSeconds: 28800 });
    expect(mocks.set).toHaveBeenCalledWith('marketoir_session', 'signed-session', expect.objectContaining({ maxAge: 28800, httpOnly: true }));
  });

  it('caps the signed token and cookie at password expiry', () => {
    const expiring = { ...session, passwordExpiresAt: new Date(Date.now() + 120000).toISOString() };
    setAdminSessionCookie(expiring);
    expect(mocks.sign).toHaveBeenCalledWith(expiring, { maxAgeSeconds: 120 });
    expect(mocks.set).toHaveBeenCalledWith('marketoir_session', 'signed-session', expect.objectContaining({ maxAge: 120 }));
  });

  it.each(['2026-10-15T12:00:00Z', '2026-10-15T11:59:59Z', 'invalid'])('does not issue an expired or invalid session', passwordExpiresAt => {
    expect(() => setAdminSessionCookie({ ...session, passwordExpiresAt })).toThrow('must be renewed');
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
