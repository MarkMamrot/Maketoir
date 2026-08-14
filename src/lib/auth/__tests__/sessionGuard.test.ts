import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { cookieJar } = vi.hoisted(() => ({ cookieJar: {} as Record<string, { value: string }> }));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => cookieJar[name] ?? undefined,
  }),
}));

import { redirectToLogin, installSessionExpiredGuard } from '../sessionGuard';
import { readSession } from '../imsSession';

describe('sessionGuard', () => {
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const assign = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { pathname: '/ims', assign },
        fetch: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
    if (originalFetch === undefined) {
      delete (globalThis as any).fetch;
    } else {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
    }
  });

  it('redirects to the login page when the app is on a protected route', () => {
    redirectToLogin();
    expect((globalThis as any).window.location.assign).toHaveBeenCalledWith('/login');
  });

  it('reads a POS session cookie when no admin session is present', () => {
    cookieJar.pos_session = { value: JSON.stringify({ businessId: 'biz-456', location_id: 12 }) };
    delete cookieJar.marketoir_session;

    const session = readSession(['marketoir_session', 'pos_session']);
    expect(session).toMatchObject({ businessId: 'biz-456', location_id: 12 });
  });

  it('wraps fetch and redirects immediately on a 401 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 401 });
    (globalThis as any).fetch = mockFetch;
    (globalThis as any).window.fetch = mockFetch;

    const restore = installSessionExpiredGuard();
    try {
      await expect((globalThis as any).fetch('/api/user/me')).rejects.toThrow('Session expired');
      expect((globalThis as any).window.location.assign).toHaveBeenCalledWith('/login');
    } finally {
      restore();
    }
  });
});
