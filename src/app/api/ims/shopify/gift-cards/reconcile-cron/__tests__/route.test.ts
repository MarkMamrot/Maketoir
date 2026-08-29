import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectionsGet,
  mockImsQuery,
  mockQuery,
  mockReportRuntimeIssue,
  mockRunImsForBusiness,
  mockGetOnlineChannelCapabilities,
  mockSync,
} = vi.hoisted(() => ({
  mockConnectionsGet: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetOnlineChannelCapabilities: vi.fn(),
  mockSync: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionsGet } }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => value }));
vi.mock('@/lib/ims/shopifyGiftCardSync', () => ({ syncShopifyGiftCardSnapshots: mockSync }));
vi.mock('@/lib/ims/businessOperations', () => ({ getOnlineChannelCapabilities: mockGetOnlineChannelCapabilities }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {} }));

import { POST } from '../route';

function cronRequest(secret?: string): Request {
  return new Request('http://localhost/api/ims/shopify/gift-cards/reconcile-cron', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/ims/shopify/gift-cards/reconcile-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
    mockGetOnlineChannelCapabilities.mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: false });
    mockImsQuery.mockResolvedValue([{ value: 'combined' }]);
    mockConnectionsGet.mockResolvedValue({ shopify_shop_id: 'shop.myshopify.com', shopify_access_token: 'token' });
    mockSync.mockResolvedValue({ success: true, synced: 2, inserted: 1, updated: 1, reviewRequired: 0, errors: 0, failures: [], total: 2 });
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('rejects requests without the cron secret', async () => {
    const response = await POST(cronRequest());
    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('reconciles each active business inside callback tenant context', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1' }, { business_id: 'biz-2' }]);

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.synced).toBe(2);
    expect(mockRunImsForBusiness.mock.calls.map(call => call[0])).toEqual(['biz-1', 'biz-2']);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('skips businesses where combined gift-card mode is disabled', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1' }]);
    mockImsQuery.mockResolvedValue([{ value: 'off' }]);

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();

    expect(json.results[0]).toMatchObject({ status: 'skipped', reason: 'gift_card_sync_disabled' });
    expect(mockConnectionsGet).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('skips businesses where Shopify is disabled before tenant context', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1' }]);
    mockGetOnlineChannelCapabilities.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: true });

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();

    expect(json.results[0]).toMatchObject({ status: 'skipped', reason: 'shopify_disabled' });
    expect(mockRunImsForBusiness).not.toHaveBeenCalled();
  });

  it('continues after one tenant fails', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1' }, { business_id: 'biz-2' }]);
    mockRunImsForBusiness
      .mockRejectedValueOnce(new Error('tenant unavailable'))
      .mockImplementationOnce(async (_businessId, callback) => callback());

    const response = await POST(cronRequest('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(207);
    expect(json.results.map((result: { status: string }) => result.status)).toEqual(['failed', 'synced']);
    expect(mockSync).toHaveBeenCalledOnce();
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1' }));
  });
});