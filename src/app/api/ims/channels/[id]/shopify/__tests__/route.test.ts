import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/businessOperations', () => ({ assertShopifyEnabled: mocks.enabled,
  isOnlineChannelDisabledError: (error: unknown) => error instanceof Error && error.name === 'OnlineChannelDisabledError' }));
vi.mock('@/lib/channels/shopifyChannelRepository', () => ({ getShopifyChannelConfiguration: mocks.get,
  saveShopifyChannel: mocks.save, ShopifyChannelValidationError: class extends Error {} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

const context = { params: { id: 'instance-1' } };

describe('GET /api/ims/channels/[id]/shopify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.get.mockResolvedValue({ channelInstanceId: 'instance-1', shopDomain: 'retail.myshopify.com' });
  });

  it('loads exact-instance configuration only for an enabled Shopify business', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(mocks.enabled).toHaveBeenCalledWith('business-1');
    expect(mocks.get).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1' });
  });

  it('conceals configuration while Shopify capability is disabled', async () => {
    const error = Object.assign(new Error('Shopify is disabled for this business.'), { name: 'OnlineChannelDisabledError', status: 403 });
    mocks.enabled.mockRejectedValue(error);
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
});