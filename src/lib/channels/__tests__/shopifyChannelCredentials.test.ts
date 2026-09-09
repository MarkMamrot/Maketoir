import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn(() => 'encrypted-envelope'),
  fetch: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/lib/encryption', () => ({ decrypt: mocks.decrypt, encrypt: mocks.encrypt }));
vi.stubGlobal('fetch', mocks.fetch);

import { getShopifyChannelAdminCredentials } from '@/lib/shopifyCredentials';

describe('getShopifyChannelAdminCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads legacy credentials only through the business-owned instance join', async () => {
    mocks.query.mockResolvedValue([{ encrypted_payload: JSON.stringify({
      authMode: 'legacy_token', shopDomain: 'retail.myshopify.com', accessToken: 'legacy-token',
      clientId: '', clientSecret: '', tokenExpiresAt: null,
    }) }]);

    const result = await getShopifyChannelAdminCredentials(' business-1 ', ' instance-1 ');

    expect(result).toMatchObject({ shopDomain: 'retail.myshopify.com', token: 'legacy-token' });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('instance.business_id = ? AND instance.channel_instance_id = ?'), [
      'business-1', 'instance-1',
    ]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('returns null when the selected instance has no matching credential', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(getShopifyChannelAdminCredentials('business-1', 'instance-1')).resolves.toBeNull();
  });

  it('renews client credentials into the same encrypted instance envelope', async () => {
    mocks.query.mockResolvedValue([{ encrypted_payload: JSON.stringify({
      authMode: 'client_credentials', shopDomain: 'retail.myshopify.com', accessToken: 'expired-token',
      clientId: 'client-id', clientSecret: 'client-secret', tokenExpiresAt: 1,
    }) }]);
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: 'renewed-token', expires_in: 3600 })));
    mocks.execute.mockResolvedValue({ affectedRows: 1 });

    const result = await getShopifyChannelAdminCredentials('business-1', 'instance-1', {
      fetchImpl: mocks.fetch,
      now: () => 1_000_000,
      encryptToken: value => value,
      persistToken: vi.fn(),
    } as any);

    expect(result?.token).toBe('renewed-token');
    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toMatchObject({
      accessToken: 'renewed-token', clientId: 'client-id', clientSecret: 'client-secret',
    });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('instance.business_id = ? AND instance.channel_instance_id = ?'), [
      'encrypted-envelope', expect.any(Number), 'business-1', 'instance-1',
    ]);
  });
});