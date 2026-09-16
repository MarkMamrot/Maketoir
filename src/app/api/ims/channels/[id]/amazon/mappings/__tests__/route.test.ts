import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), list: vi.fn(), search: vi.fn(), create: vi.fn(),
  controls: vi.fn(), invalidate: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance,
  invalidateAmazonReadinessForBusiness: mocks.invalidate,
} }));
vi.mock('@/lib/channels/amazonMappingRepository', () => ({
  listAmazonMappings: mocks.list,
  searchAmazonMappingCandidates: mocks.search,
  createAmazonExistingAsinMapping: mocks.create,
  setAmazonMappingControls: mocks.controls,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

const context = { params: { id: 'amazon-1' } };
function request(method: string, body?: unknown, query = '') {
  return new Request(`http://localhost/api/ims/channels/amazon-1/amazon/mappings${query}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Amazon mappings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'amazon-1', provider: 'amazon' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('searches IMS variants within the authorized exact instance', async () => {
    mocks.search.mockResolvedValue([{ variantId: 'variant-1', sku: 'SKU-1' }]);
    const response = await GET(request('GET', undefined, '?q=blue'), context);
    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'amazon-1', search: 'blue',
    });
  });

  it('creates a mapping and invalidates readiness without publishing', async () => {
    const response = await POST(request('POST', {
      variantId: 'variant-1', asin: 'B012345678', sellerSku: 'SELLER-1',
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'amazon-1', variantId: 'variant-1',
      asin: 'B012345678', sellerSku: 'SELLER-1',
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'amazon-1' });
  });

  it('returns a conflict for an already-mapped variant or seller SKU', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    const response = await POST(request('POST', {
      variantId: 'variant-1', asin: 'B012345678', sellerSku: 'SELLER-1',
    }), context);
    expect(response.status).toBe(409);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
});