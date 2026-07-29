import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMetaAuthorizeUrl, listMetaAdAccounts } from '../MetaOAuthService';

describe('MetaOAuthService', () => {
  beforeEach(() => {
    process.env.META_APP_ID = 'app-123';
    process.env.META_APP_SECRET = 'app-secret';
    process.env.META_GRAPH_API_VERSION = 'v25.0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_GRAPH_API_VERSION;
  });

  it('builds a read-only tenant consent URL', () => {
    const url = new URL(buildMetaAuthorizeUrl('https://solvantis.com.au/api/meta/callback', 'signed-state'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v25.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app-123');
    expect(url.searchParams.get('scope')).toBe('ads_read,business_management');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('paginates and deduplicates accounts without putting the token in a URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'act_2', name: 'Second', currency: 'AUD', account_status: 1 }],
        paging: { cursors: { after: 'next-cursor' }, next: 'present' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: 'act_2', name: 'Second', currency: 'AUD', account_status: 1 },
          { id: 'act_1', name: 'First', currency: 'AUD', account_status: 1 },
        ],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listMetaAdAccounts('tenant-secret-token')).resolves.toEqual([
      { id: 'act_1', accountId: '1', name: 'First', currency: 'AUD', accountStatus: 1 },
      { id: 'act_2', accountId: '2', name: 'Second', currency: 'AUD', accountStatus: 1 },
    ]);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).not.toContain('tenant-secret-token');
      expect(init.headers.Authorization).toBe('Bearer tenant-secret-token');
    }
  });
});