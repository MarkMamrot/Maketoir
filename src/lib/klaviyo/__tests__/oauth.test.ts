import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/encryption', () => ({ encrypt: (value: string) => value, decrypt: (value: string) => value }));
const mocks = vi.hoisted(() => ({ getPool: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn(), execute: vi.fn(), getPool: mocks.getPool }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: vi.fn() } }));
import { createKlaviyoAuthorization, readKlaviyoAuthorization, exchangeKlaviyoToken, createKlaviyoClient } from '../oauth';

describe('Klaviyo OAuth', () => {
  beforeEach(() => {
    vi.stubEnv('KLAVIYO_CLIENT_ID', 'client');
    vi.stubEnv('KLAVIYO_CLIENT_SECRET', 'secret');
    vi.stubEnv('APP_URL', 'https://solvantis.example');
  });

  it('generates unique PKCE requests and binds state to the initiating actor and tenant', () => {
    const authorization = createKlaviyoAuthorization('business-1', 42);
    const url = new URL(authorization.url);
    expect(url.origin).toBe('https://www.klaviyo.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    const state = url.searchParams.get('state')!;
    expect(readKlaviyoAuthorization(authorization.cookie, state, 'business-1', 42)).not.toBeNull();
    expect(readKlaviyoAuthorization(authorization.cookie, state, 'business-2', 42)).toBeNull();
    expect(readKlaviyoAuthorization(authorization.cookie, state, 'business-1', 43)).toBeNull();
    expect(readKlaviyoAuthorization(authorization.cookie, 'wrong', 'business-1', 42)).toBeNull();
    expect(createKlaviyoAuthorization('business-1', 42).url).not.toBe(authorization.url);
  });

  it('exchanges form-encoded codes server-side without placing secrets in URLs', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'profiles:read',
    })));
    await expect(exchangeKlaviyoToken({ grant_type: 'authorization_code', code: 'code', code_verifier: 'verifier' }, fetcher))
      .resolves.toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(fetcher).toHaveBeenCalledWith('https://a.klaviyo.com/oauth/token', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    }));
  });

  it('does not expose provider error payloads', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_description: 'sensitive' }), { status: 400 }));
    await expect(exchangeKlaviyoToken({}, fetcher)).rejects.toThrow('Klaviyo authorization failed (HTTP 400).');
  });

  it('reuses an unexpired access token without refreshing', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
      query: vi.fn().mockResolvedValue([[{ access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 3600_000 }]]),
    };
    mocks.getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    const client = await createKlaviyoClient('business-1');
    expect(client).toBeDefined();
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['business-1']);
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('refreshes expired credentials while holding the tenant credential lock', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
      query: vi.fn().mockResolvedValue([[{ access_token: 'old', refresh_token: 'refresh', expires_at: 0 }]]),
    };
    mocks.getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600,
    })));
    vi.stubGlobal('fetch', fetcher);
    try {
      await createKlaviyoClient('business-1');
      expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ?'),
        ['new-access', 'new-refresh', expect.any(Number), 'business-1']);
      expect(connection.commit).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rolls back failed refreshes and releases the credential lock', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
      query: vi.fn().mockResolvedValue([[{ access_token: 'old', refresh_token: 'refresh', expires_at: 0 }]]),
    };
    mocks.getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    try {
      await expect(createKlaviyoClient('business-1')).rejects.toThrow('Reconnect Klaviyo');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.execute).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});