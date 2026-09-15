import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), markSetup: vi.fn(), access: vi.fn(),
  list: vi.fn(), sync: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, markAmazonSetupOperationForBusiness: mocks.markSetup,
} }));
vi.mock('@/lib/channels/amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('@/lib/channels/amazonSpApi', () => ({ listAmazonListings: mocks.list }));
vi.mock('@/lib/channels/amazonListingSync', () => ({ syncAmazonListingMappings: mocks.sync }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const context = { params: { id: 'instance-1' } };
function request(body: unknown = {}) {
  return new Request('http://localhost/api/ims/channels/instance-1/amazon/listings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST Amazon channel listings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'amazon' });
    mocks.access.mockResolvedValue({ accessToken: 'access', sellerId: 'A1SELLER99' });
    mocks.list.mockResolvedValue({ items: [{ sku: 'SKU-1' }], nextToken: null });
    mocks.sync.mockResolvedValue({ linked: 1, unmatched: 0, conflicts: 0 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an administrator', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.getInstance).not.toHaveBeenCalled();
  });

  it('rejects a non-Amazon or cross-business instance', async () => {
    mocks.getInstance.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it('uses exact-instance credentials and stamps only the final page', async () => {
    const response = await POST(request({ pageSize: 20 }), context);
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith('business-1', 'instance-1');
    expect(mocks.list).toHaveBeenCalledWith('access', 'A1SELLER99', { pageSize: 20, nextToken: null });
    expect(mocks.sync).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', items: [{ sku: 'SKU-1' }],
    });
    expect(mocks.markSetup).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', operation: 'listings',
    });
  });

  it('does not stamp an intermediate page', async () => {
    mocks.list.mockResolvedValue({ items: [], nextToken: 'next' });
    await POST(request({ nextToken: 'current' }), context);
    expect(mocks.markSetup).not.toHaveBeenCalled();
  });

  it('reports failures without returning provider details', async () => {
    mocks.list.mockRejectedValue(new Error('provider payload with token'));
    const response = await POST(request(), context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Amazon listings could not be synchronized.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'sync_amazon_listings',
    }));
  });
});