import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), setReadiness: vi.fn(), disabled: vi.fn(),
  credentials: vi.fn(), test: vi.fn(), report: vi.fn(), amazonAccess: vi.fn(),
  amazonParticipations: vi.fn(), requireAmazonAu: vi.fn(), markSetup: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, setReadinessForBusiness: mocks.setReadiness,
  markAmazonSetupOperationForBusiness: mocks.markSetup,
} }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.disabled }));
vi.mock('@/lib/shopifyCredentials', () => ({ getShopifyChannelAdminCredentials: mocks.credentials }));
vi.mock('@/lib/channels/shopifyReadiness', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/channels/shopifyReadiness')>()), testShopifyReadiness: mocks.test,
}));
vi.mock('@/lib/channels/amazonCredentials', () => ({ getAmazonChannelAccess: mocks.amazonAccess }));
vi.mock('@/lib/channels/amazonSpApi', () => ({
  getAmazonMarketplaceParticipations: mocks.amazonParticipations,
  requireActiveAmazonAustraliaParticipation: mocks.requireAmazonAu,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = new Request('http://localhost/api/ims/channels/instance-1/test', { method: 'POST' });
const context = { params: { id: 'instance-1' } };

describe('POST /api/ims/channels/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'shopify' });
    mocks.disabled.mockResolvedValue(null);
    mocks.credentials.mockResolvedValue({ shopDomain: 'retail.myshopify.com', token: 'secret' });
    mocks.test.mockResolvedValue(undefined);
    mocks.amazonAccess.mockResolvedValue({ accessToken: 'amazon-access', sellerId: 'A1SELLER99' });
    mocks.amazonParticipations.mockResolvedValue([{ marketplace: { id: 'au' } }]);
    mocks.requireAmazonAu.mockReturnValue({ storeName: 'Retail AU' });
    mocks.setReadiness.mockResolvedValue({ channelInstanceId: 'instance-1', readinessStatus: 'ready' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an administrator', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request, context)).status).toBe(403);
    expect(mocks.getInstance).not.toHaveBeenCalled();
  });

  it('returns 404 for an instance outside the business', async () => {
    mocks.getInstance.mockResolvedValue(null);
    expect((await POST(request, context)).status).toBe(404);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it('tests exact-instance credentials and records readiness', async () => {
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.credentials).toHaveBeenCalledWith('business-1', 'instance-1');
    expect(mocks.setReadiness).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: true,
    });
  });

  it('rejects providers without a readiness adapter', async () => {
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'native_shop' });
    expect((await POST(request, context)).status).toBe(400);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it('refreshes and tests the exact Amazon seller instance', async () => {
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'amazon' });
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.amazonAccess).toHaveBeenCalledWith('business-1', 'instance-1');
    expect(mocks.amazonParticipations).toHaveBeenCalledWith('amazon-access');
    expect(mocks.requireAmazonAu).toHaveBeenCalledOnce();
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.markSetup).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', operation: 'authorization',
    });
    expect(mocks.setReadiness).not.toHaveBeenCalled();
  });

  it('stores a safe Amazon authorization failure', async () => {
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'amazon' });
    mocks.amazonParticipations.mockRejectedValue(new Error('provider payload with access token'));
    const response = await POST(request, context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: 'Amazon rejected the saved authorization.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'test_amazon_connection' }));
  });

  it('stores and reports a safe failed result', async () => {
    mocks.test.mockRejectedValue(new Error('Shopify readiness check failed with HTTP 401. secret-token'));
    const response = await POST(request, context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: 'Shopify rejected the saved credentials.' });
    expect(mocks.setReadiness).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: false,
      safeError: 'Shopify rejected the saved credentials.',
    });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'test_shopify_connection' }));
  });
});