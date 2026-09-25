import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/businessOperations', () => ({ assertShopifyEnabled: mocks.enabled,
  isOnlineChannelDisabledError: () => false }));
vi.mock('@/lib/channels/shopifyChannelRepository', () => ({ saveShopifyChannel: mocks.save,
  ShopifyChannelValidationError: class extends Error {} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

describe('POST /api/ims/channels/shopify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.save.mockResolvedValue('instance-1');
  });

  it('creates exact-instance credentials for an enabled Shopify business', async () => {
    const response = await POST(new Request('http://localhost/api/ims/channels/shopify', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Retail',
        shopDomain: 'retail.myshopify.com', authMode: 'client_credentials', clientId: 'id', clientSecret: 'secret' }) }));
    expect(response.status).toBe(200);
    expect(mocks.enabled).toHaveBeenCalledWith('business-1');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', shopDomain: 'retail.myshopify.com' }));
  });

  it('requires an administrator', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'StandardUser' });
    const response = await POST(new Request('http://localhost/api/ims/channels/shopify', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});