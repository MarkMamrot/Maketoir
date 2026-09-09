import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockListForBusiness, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockListForBusiness: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness: mockListForBusiness },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET } from '../route';

describe('GET /api/ims/channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('requires an IMS session', async () => {
    mockGetImsSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockListForBusiness).not.toHaveBeenCalled();
  });

  it('returns business-owned instances with adapter capabilities and no credentials', async () => {
    mockListForBusiness.mockResolvedValue([{
      channelInstanceId: 'instance-1', businessId: 'business-1', provider: 'shopify',
      displayName: 'Australia Store', externalAccountKey: 'australia.myshopify.com', enabled: true,
      runtimeStatus: 'active', readinessStatus: 'ready', settings: {}, lastSyncAt: null, safeError: null,
    }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListForBusiness).toHaveBeenCalledWith('business-1');
    expect(body.instances[0]).toMatchObject({
      channelInstanceId: 'instance-1', provider: 'shopify', providerDisplayName: 'Shopify',
      capabilities: { catalogue: true, giftCards: true, settlements: true },
    });
    expect(JSON.stringify(body)).not.toContain('credential');
    expect(JSON.stringify(body)).not.toContain('accessToken');
  });

  it('reports operational load failures without exposing their details', async () => {
    mockListForBusiness.mockRejectedValue(new Error('database unavailable'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Sales channels could not be loaded.');
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', source: 'ims.channels', operation: 'list',
    }));
  });
});