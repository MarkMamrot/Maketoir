import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockConnectionsGet, mockDecrypt, mockImsQuery, mockSyncCustomer, mockShopifyCtor, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockConnectionsGet: vi.fn(),
  mockDecrypt: vi.fn(),
  mockImsQuery: vi.fn(),
  mockSyncCustomer: vi.fn(),
  mockShopifyCtor: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionsGet } }));
vi.mock('@/lib/encryption', () => ({ decrypt: mockDecrypt }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncCustomer: mockSyncCustomer },
}));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    constructor(shop: string, token: string) { mockShopifyCtor(shop, token); }
  },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { POST } from '../route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/ims/loyalty/shopify-metafields', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/loyalty/shopify-metafields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockConnectionsGet.mockResolvedValue({
      shopify_shop_id: 'example.myshopify.com', shopify_access_token: 'encrypted',
    });
    mockDecrypt.mockReturnValue('plain-token');
    mockSyncCustomer.mockImplementation(async ({ contactId }: { contactId: number }) => ({
      status: 'synced', contactId, shopifyCustomerId: String(contactId), balancePoints: 10,
    }));
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('requires an authenticated IMS session', async () => {
    mockGetImsSession.mockResolvedValue(null);
    const response = await POST(request({ contactId: 42 }));
    expect(response.status).toBe(401);
    expect(mockSyncCustomer).not.toHaveBeenCalled();
  });

  it('syncs one customer using tenant Shopify credentials', async () => {
    const response = await POST(request({ contactId: 42 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, processed: 1, synced: 1, hasMore: false });
    expect(mockShopifyCtor).toHaveBeenCalledWith('example.myshopify.com', 'plain-token');
    expect(mockSyncCustomer).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', contactId: 42 }));
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('returns a stable cursor for a bounded bulk catch-up page', async () => {
    mockImsQuery.mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }]);
    const response = await POST(request({ afterId: 5, limit: 2 }));
    const body = await response.json();

    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), ['business-1', 5, 3]);
    expect(mockSyncCustomer.mock.calls.map(call => call[0].contactId)).toEqual([10, 11]);
    expect(body).toMatchObject({ processed: 2, synced: 2, nextAfterId: 11, hasMore: true });
  });

  it('reports unexpected batch discovery failures without exposing their details', async () => {
    mockImsQuery.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request({ afterId: 5, limit: 2 }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Shopify loyalty catch-up failed.');
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      operation: 'bulk_sync_customer_metafields',
      context: { requestedContactId: null, afterId: 5, limit: 2 },
    }));
  });
});