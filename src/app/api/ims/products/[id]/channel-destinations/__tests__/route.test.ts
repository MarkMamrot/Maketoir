import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), query: vi.fn(), listInstances: vi.fn(), evaluate: vi.fn(), links: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness: mocks.listInstances },
}));
vi.mock('@/lib/channels/channelProductAssignmentRepository', () => ({ evaluateChannelProducts: mocks.evaluate }));
vi.mock('@/lib/channels/channelProductLinks', () => ({ getChannelProductLinks: mocks.links }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

const request = new Request('http://localhost/api/ims/products/product-1/channel-destinations');
const context = { params: { id: 'product-1' } };

describe('GET product channel destinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.query.mockResolvedValue([{ product_id: 'product-1' }]);
    mocks.listInstances.mockResolvedValue([{
      channelInstanceId: 'instance-1', businessId: 'business-1', provider: 'shopify', displayName: 'Retail Store',
      runtimeStatus: 'active', readinessStatus: 'ready', settings: { productAssignmentMode: 'add_matches' },
    }]);
    mocks.evaluate.mockResolvedValue({ products: [{ ruleDecision: 'include', effectiveDecision: 'exclude',
      matchedRuleName: 'Online range', overrideMode: 'exclude', desiredState: 'published',
      providerState: 'published' }], total: 1, applied: 0 });
    mocks.links.mockResolvedValue({ storefrontUrl: 'https://store.example/products/dress',
      adminUrl: 'https://admin.shopify.com/store/example/products/123' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an IMS session', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(401);
    expect(mocks.listInstances).not.toHaveBeenCalled();
  });

  it('returns the exact product evaluation for each business channel', async () => {
    const response = await GET(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id = ? AND product_id = ?'),
      ['business-1', 'product-1']);
    expect(mocks.listInstances).toHaveBeenCalledWith('business-1');
    expect(mocks.evaluate).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1',
      productId: 'product-1', limit: 1, assignmentMode: 'add_matches' });
    expect(body.destinations[0]).toMatchObject({ displayName: 'Retail Store', providerDisplayName: 'Shopify',
      assignmentMode: 'add_matches', effectiveDecision: 'exclude', desiredState: 'published', providerState: 'published' });
    expect(body.destinations[0]).toMatchObject({ storefrontUrl: 'https://store.example/products/dress',
      adminUrl: 'https://admin.shopify.com/store/example/products/123' });
  });

  it('does not evaluate channels when the product is outside the tenant', async () => {
    mocks.query.mockResolvedValue([]);
    expect((await GET(request, context)).status).toBe(404);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('reports evaluation failures without exposing details', async () => {
    mocks.evaluate.mockRejectedValue(new Error('missing assignment table'));
    const response = await GET(request, context);
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'load_channel_destinations', context: { productId: 'product-1' },
    }));
  });
});