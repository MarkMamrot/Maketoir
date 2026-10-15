import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), cin7Credentials: vi.fn(), getConnection: vi.fn(), fetch: vi.fn(), klaviyo: vi.fn(),
  klaviyoTest: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: async () => ({ businessId: 'business-1' }) }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: () => ({ user: { businessId: 'business-1' } }) }));
vi.mock('@/lib/cin7Helpers', () => ({ getCin7Credentials: mocks.cin7Credentials }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mocks.getConnection } }));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => value.replace(/^encrypted:/, '') }));
vi.mock('@/lib/ims/integrationAvailability', () => ({
  assertOptionalIntegrationEnabled: mocks.guard,
  isIntegrationDisabledError: (error: { code?: string }) => error?.code === 'integration_disabled',
}));
vi.mock('@/services/KlaviyoService', () => ({
  KlaviyoService: class {
    revision = 'test';
    constructor(apiKey: string) { mocks.klaviyo(apiKey); }
    testConnection = mocks.klaviyoTest;
  },
}));

import { GET as cin7Get, POST as cin7Post } from '@/app/api/sync/cin7/route';
import { GET as gmailGet, POST as gmailPost } from '@/app/api/sync/gmail/route';
import { POST as klaviyoPost } from '@/app/api/sync/klaviyo/route';

function request(provider: string, body: Record<string, unknown> = {}): Request {
  return new Request(`http://localhost/api/sync/${provider}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('optional provider connection-test credential contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.guard.mockResolvedValue(undefined);
    mocks.cin7Credentials.mockResolvedValue({ accountId: 'saved-account', apiKey: 'saved-key' });
    mocks.getConnection.mockResolvedValue({
      gmail_refresh_token: 'encrypted:saved-token', gmail_client_id: 'client-id',
      gmail_client_secret: 'encrypted:client-secret', klaviyo_api_key: 'encrypted:saved-klaviyo',
    });
    mocks.klaviyoTest.mockResolvedValue(1);
    mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.includes('oauth2.googleapis.com') ? { access_token: 'access' }
        : { emailAddress: 'shop@example.com', messagesTotal: 1 },
    ), { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('tests saved Cin7 credentials when drafts are omitted', async () => {
    expect((await cin7Post(request('cin7'))).status).toBe(200);
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization)
      .toBe(`Basic ${Buffer.from('saved-account:saved-key').toString('base64')}`);
  });

  it('allows retained Cin7 secrets with a submitted account ID', async () => {
    expect((await cin7Post(request('cin7', { accountId: 'draft-account' }))).status).toBe(200);
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization)
      .toBe(`Basic ${Buffer.from('draft-account:saved-key').toString('base64')}`);
  });

  it('tests saved Gmail refresh token without returning it', async () => {
    const response = await gmailPost(request('gmail'));
    expect(response.status).toBe(200);
    expect(mocks.fetch.mock.calls[0][1].body.get('refresh_token')).toBe('saved-token');
    expect(await response.json()).toEqual({ success: true, email: 'shop@example.com', messagesTotal: 1 });
  });

  it('prefers a draft Gmail token supplied in the POST body', async () => {
    expect((await gmailPost(request('gmail', { refreshToken: 'draft-token' }))).status).toBe(200);
    expect(mocks.fetch.mock.calls[0][1].body.get('refresh_token')).toBe('draft-token');
  });

  it('tests retained Klaviyo credentials with an omitted draft key', async () => {
    expect((await klaviyoPost(request('klaviyo'))).status).toBe(200);
    expect(mocks.klaviyo).toHaveBeenCalledWith('saved-klaviyo');
  });

  it('retains saved-credential GET compatibility', async () => {
    expect((await cin7Get(new Request('http://localhost/api/sync/cin7'))).status).toBe(200);
    expect((await gmailGet(new Request('http://localhost/api/sync/gmail'))).status).toBe(200);
  });

  it.each([
    ['cin7', cin7Post], ['gmail', gmailPost], ['klaviyo', klaviyoPost],
  ])('blocks %s tests before reading credentials or calling a provider while off', async (provider, handler) => {
    mocks.guard.mockRejectedValue(Object.assign(new Error('Disabled'), { code: 'integration_disabled', status: 423 }));
    expect((await handler(request(provider))).status).toBe(423);
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.cin7Credentials).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.klaviyoTest).not.toHaveBeenCalled();
  });
});
