import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), getCookie: vi.fn(), setCookie: vi.fn(), authorize: vi.fn(), readState: vi.fn(),
  save: vi.fn(), disconnect: vi.fn(), connected: vi.fn(), config: vi.fn(), availability: vi.fn(),
  legacy: vi.fn(), report: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: () => ({ get: mocks.getCookie, set: mocks.setCookie }) }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.guard }));
vi.mock('@/lib/klaviyo/oauth', () => ({
  createKlaviyoAuthorization: mocks.authorize, readKlaviyoAuthorization: mocks.readState,
  saveKlaviyoAuthorization: mocks.save, disconnectKlaviyoOAuth: mocks.disconnect,
  hasKlaviyoOAuthConnection: mocks.connected, klaviyoOAuthConfig: mocks.config,
}));
vi.mock('@/lib/ims/integrationAvailability', () => ({ assertOptionalIntegrationEnabled: mocks.availability }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mocks.legacy } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST, DELETE } from '../route';
import { GET as callback } from '../callback/route';

describe('Klaviyo OAuth routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('APP_URL', 'https://app.example');
    mocks.guard.mockReturnValue({ user: { userId: 42, businessId: 'business-1' } });
    mocks.authorize.mockReturnValue({ url: 'https://www.klaviyo.com/oauth/authorize', cookie: 'encrypted-state' });
    mocks.getCookie.mockReturnValue({ value: 'encrypted-state' });
    mocks.readState.mockReturnValue({ verifier: 'verifier' });
    mocks.connected.mockResolvedValue(true);
    mocks.legacy.mockResolvedValue(null);
    mocks.report.mockResolvedValue(null);
    mocks.save.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.availability.mockResolvedValue(undefined);
  });

  it('requires Admin authorization before starting a connection', async () => {
    mocks.guard.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(new Request('https://app.example/api/klaviyo/oauth', { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it('rejects cross-origin authorization and disconnect requests', async () => {
    for (const handler of [POST, DELETE]) {
      const response = await handler(new Request('https://app.example/api/klaviyo/oauth', {
        method: handler === POST ? 'POST' : 'DELETE', headers: { origin: 'https://evil.example' },
      }));
      expect(response.status).toBe(403);
    }
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it('stores an HttpOnly bounded PKCE state cookie for the active business', async () => {
    const response = await POST(new Request('https://app.example/api/klaviyo/oauth', {
      method: 'POST', headers: { origin: 'https://app.example' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith('business-1', 42);
    expect(mocks.setCookie).toHaveBeenCalledWith('klaviyo_oauth_state', 'encrypted-state',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 600 }));
  });

  it('returns connection status without credentials', async () => {
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ configured: true, connected: true, oauth: true });
  });

  it('rejects invalid callback state before exchanging a code', async () => {
    mocks.readState.mockReturnValue(null);
    const response = await callback(new Request('https://app.example/api/klaviyo/oauth/callback?code=code&state=state'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('klaviyoError=');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.readState).toHaveBeenCalledWith('encrypted-state', 'state', 'business-1', 42);
  });

  it('handles denied authorization without changing saved credentials', async () => {
    const response = await callback(new Request('https://app.example/api/klaviyo/oauth/callback?error=access_denied&state=state'));
    expect(response.headers.get('location')).toContain('klaviyoError=');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('saves approved authorization only for the active business and clears state', async () => {
    const response = await callback(new Request('https://app.example/api/klaviyo/oauth/callback?code=code&state=state'));
    expect(mocks.save).toHaveBeenCalledWith('business-1', 'code', 'verifier');
    expect(mocks.setCookie).toHaveBeenCalledWith('klaviyo_oauth_state', '', expect.objectContaining({ maxAge: 0 }));
    expect(response.headers.get('location')).toContain('klaviyoSuccess=');
    expect(response.headers.get('location')).toContain('#connection-klaviyo');
  });

  it('disconnects only the authenticated business', async () => {
    const response = await DELETE(new Request('https://app.example/api/klaviyo/oauth', {
      method: 'DELETE', headers: { origin: 'https://app.example' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith('business-1');
  });
});