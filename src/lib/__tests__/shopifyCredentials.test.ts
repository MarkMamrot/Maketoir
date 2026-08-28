import { describe, expect, it, vi } from 'vitest';
import type { ConnectionsRow } from '@/lib/db/ConnectionsRepository';
import { resolveShopifyAdminCredentials } from '@/lib/shopifyCredentials';

function connection(overrides: Partial<ConnectionsRow> = {}): ConnectionsRow {
  return {
    business_id: 'business-1',
    shopify_shop_id: 'sage-store.myshopify.com',
    shopify_auth_mode: 'legacy_token',
    shopify_access_token: 'legacy-token',
    shopify_client_id: null,
    shopify_client_secret: null,
    shopify_token_expires_at: null,
    ...overrides,
  } as ConnectionsRow;
}

function dependencies(now = 1_000_000) {
  return {
    fetchImpl: vi.fn(),
    now: () => now,
    encryptToken: (value: string) => `encrypted:${value.length}`,
    persistToken: vi.fn().mockResolvedValue(undefined),
  };
}

describe('resolveShopifyAdminCredentials', () => {
  it('passes through a legacy permanent access token', async () => {
    const deps = dependencies();

    const result = await resolveShopifyAdminCredentials('business-1', connection(), deps as any);

    expect(result).toEqual({
      authMode: 'legacy_token',
      shopDomain: 'sage-store.myshopify.com',
      shopName: 'sage-store',
      token: 'legacy-token',
    });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('reuses a client-credentials token that remains valid beyond the renewal margin', async () => {
    const deps = dependencies();
    const result = await resolveShopifyAdminCredentials('business-1', connection({
      shopify_auth_mode: 'client_credentials',
      shopify_access_token: 'cached-token',
      shopify_client_id: 'client-id',
      shopify_client_secret: 'client-secret',
      shopify_token_expires_at: 1_000_000 + 10 * 60 * 1000,
    }), deps as any);

    expect(result.token).toBe('cached-token');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.persistToken).not.toHaveBeenCalled();
  });

  it('renews and persists an expired client-credentials token', async () => {
    const deps = dependencies();
    deps.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'renewed-token',
      expires_in: 86399,
    })));

    const result = await resolveShopifyAdminCredentials('business-1', connection({
      shopify_auth_mode: 'client_credentials',
      shopify_access_token: 'expired-token',
      shopify_client_id: 'client-id',
      shopify_client_secret: 'client-secret',
      shopify_token_expires_at: 999_999,
    }), deps as any);

    expect(result.token).toBe('renewed-token');
    expect(deps.fetchImpl).toHaveBeenCalledWith(
      'https://sage-store.myshopify.com/admin/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = deps.fetchImpl.mock.calls[0][1];
    expect(String(request.body)).toContain('grant_type=client_credentials');
    expect(String(request.body)).toContain('client_id=client-id');
    expect(String(request.body)).toContain('client_secret=client-secret');
    expect(deps.persistToken).toHaveBeenCalledWith(
      'business-1',
      expect.not.stringContaining('renewed-token'),
      1_000_000 + 86399 * 1000,
    );
  });
});