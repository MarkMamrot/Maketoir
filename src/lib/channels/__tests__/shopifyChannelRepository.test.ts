import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(), execute: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  encrypt: vi.fn(() => 'encrypted-envelope'), decrypt: vi.fn((value: string) => value),
}));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: mocks.getConnection }) }));
vi.mock('@/lib/encryption', () => ({ encrypt: mocks.encrypt, decrypt: mocks.decrypt }));

import { saveShopifyChannel } from '../shopifyChannelRepository';

describe('Shopify channel repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({ execute: mocks.execute, beginTransaction: mocks.begin, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release });
  });

  it('creates a distinct draft instance with encrypted exact-store credentials', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);
    const channelInstanceId = await saveShopifyChannel({ businessId: 'business-1', displayName: 'Retail Shopify',
      shopDomain: 'retail', authMode: 'client_credentials', clientId: 'client-id', clientSecret: 'client-secret' });
    expect(channelInstanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.execute.mock.calls[1][0]).toContain("VALUES (?, ?, 'shopify'");
    expect(mocks.execute.mock.calls[1][1]).toEqual([channelInstanceId, 'business-1', 'Retail Shopify', 'retail.myshopify.com']);
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toMatchObject({ shopDomain: 'retail.myshopify.com', clientId: 'client-id', clientSecret: 'client-secret' });
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('retains a masked existing secret while updating the same business-owned instance', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: 'instance-1', business_id: 'business-1', display_name: 'Old',
        external_account_key: 'retail.myshopify.com', encrypted_payload: JSON.stringify({ authMode: 'client_credentials',
          shopDomain: 'retail.myshopify.com', accessToken: '', clientId: 'old-client', clientSecret: 'saved-secret', tokenExpiresAt: 123 }) }]])
      .mockResolvedValueOnce([[]]);
    await saveShopifyChannel({ businessId: 'business-1', channelInstanceId: 'instance-1', displayName: 'Retail',
      shopDomain: 'retail.myshopify.com', authMode: 'client_credentials', clientId: 'new-client', clientSecret: '' });
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toMatchObject({ clientId: 'new-client', clientSecret: 'saved-secret', tokenExpiresAt: null });
    expect(mocks.execute.mock.calls[2][0]).toContain("is_enabled = IF(? = 1, 0, is_enabled)");
    expect(mocks.execute.mock.calls[2][1]).toEqual(['Retail', 'retail.myshopify.com', 1, 1, 1, 1, 'business-1', 'instance-1']);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('preserves activation and readiness when only unchanged configuration is saved', async () => {
    const envelope = JSON.stringify({ authMode: 'client_credentials', shopDomain: 'retail.myshopify.com',
      accessToken: 'cached-token', clientId: 'client-id', clientSecret: 'saved-secret', tokenExpiresAt: 123 });
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: 'instance-1', business_id: 'business-1', display_name: 'Old',
        external_account_key: 'retail.myshopify.com', encrypted_payload: envelope }]])
      .mockResolvedValueOnce([[]]);
    await saveShopifyChannel({ businessId: 'business-1', channelInstanceId: 'instance-1', displayName: 'Retail',
      shopDomain: 'retail.myshopify.com', authMode: 'client_credentials', clientId: 'client-id', clientSecret: '' });
    expect(mocks.execute.mock.calls[2][1]).toEqual(['Retail', 'retail.myshopify.com', 0, 0, 0, 0, 'business-1', 'instance-1']);
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toMatchObject({ accessToken: 'cached-token', tokenExpiresAt: 123 });
  });

  it('requires a replacement secret when the permanent store domain changes', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: 'instance-1', business_id: 'business-1', display_name: 'Old',
        external_account_key: 'old.myshopify.com', encrypted_payload: JSON.stringify({ authMode: 'legacy_token',
          shopDomain: 'old.myshopify.com', accessToken: 'old-token', clientId: '', clientSecret: '', tokenExpiresAt: null }) }]])
      .mockResolvedValueOnce([[]]);
    await expect(saveShopifyChannel({ businessId: 'business-1', channelInstanceId: 'instance-1', displayName: 'New',
      shopDomain: 'new.myshopify.com', authMode: 'legacy_token', accessToken: '' })).rejects.toThrow('Enter the Shopify Admin API access token');
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('allows corrupt saved credentials to be replaced explicitly', async () => {
    mocks.decrypt.mockImplementationOnce(() => { throw new Error('invalid envelope'); });
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: 'instance-1', business_id: 'business-1', display_name: 'Old',
        external_account_key: 'retail.myshopify.com', encrypted_payload: 'corrupt' }]])
      .mockResolvedValueOnce([[]]);
    await expect(saveShopifyChannel({ businessId: 'business-1', channelInstanceId: 'instance-1', displayName: 'Retail',
      shopDomain: 'retail.myshopify.com', authMode: 'legacy_token', accessToken: 'replacement' })).resolves.toBe('instance-1');
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rejects a store already connected elsewhere and rolls back', async () => {
    mocks.execute.mockResolvedValueOnce([[{ channel_instance_id: 'other', business_id: 'business-2' }]]);
    await expect(saveShopifyChannel({ businessId: 'business-1', displayName: 'Retail', shopDomain: 'retail.myshopify.com',
      authMode: 'legacy_token', accessToken: 'token' })).rejects.toThrow('already connected');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('rejects malformed suffix-matching Shopify hostnames before opening a transaction', async () => {
    await expect(saveShopifyChannel({ businessId: 'business-1', displayName: 'Retail',
      shopDomain: 'nested.retail.myshopify.com', authMode: 'legacy_token', accessToken: 'token' }))
      .rejects.toThrow('permanent Shopify store domain');
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
});