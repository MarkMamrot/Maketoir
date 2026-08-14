import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { redirectToLogin, installSessionExpiredGuard } from '../sessionGuard';

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
