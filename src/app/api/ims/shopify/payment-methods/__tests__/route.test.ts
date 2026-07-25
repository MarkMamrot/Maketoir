import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession,
  mockConnectionsGet,
  mockDecrypt,
  mockImsQuery,
  mockGetAllOrders,
  mockShopifyCtor,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockConnectionsGet: vi.fn(),
  mockDecrypt: vi.fn(),
  mockImsQuery: vi.fn(),
  mockGetAllOrders: vi.fn(),
  mockShopifyCtor: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({
  getImsSession: mockGetImsSession,
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: {
    get: mockConnectionsGet,
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: mockDecrypt,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
}));

vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    constructor(shop: string, token: string) {
      mockShopifyCtor(shop, token);
    }

    getAllOrders(syncFrom: string) {
      return mockGetAllOrders(syncFrom);
    }
  },
}));

import { GET } from '../route';

describe('GET /api/ims/shopify/payment-methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mockConnectionsGet.mockResolvedValue({
      shopify_shop_id: 'my-shop.myshopify.com',
      shopify_access_token: 'enc-token',
    });
    mockDecrypt.mockReturnValue('plain-token');
    mockImsQuery.mockResolvedValue([{ value: '2026-07-01' }]);
  });

  it('returns 401 when session is missing', async () => {
    mockGetImsSession.mockResolvedValueOnce(null);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Not authenticated');
  });

  it('returns 400 when Shopify credentials are not configured', async () => {
    mockConnectionsGet.mockResolvedValueOnce({
      shopify_shop_id: null,
      shopify_access_token: null,
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Shopify credentials not configured.');
  });

  it('aggregates and normalizes gateway methods from Shopify orders', async () => {
    mockGetAllOrders.mockResolvedValueOnce([
      {
        id: 101,
        name: '#1001',
        payment_gateway_names: ['PayPal Express', 'Afterpay'],
      },
      {
        id: 102,
        name: '#1002',
        payment_gateway_names: ['paypal express'],
      },
      {
        id: 103,
        order_number: '1003',
        payment_gateway_name: 'Shopify Payments',
      },
      {
        id: 104,
        gateway: 'Manual',
      },
      {
        id: 105,
      },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    expect(mockShopifyCtor).toHaveBeenCalledWith('my-shop.myshopify.com', 'plain-token');
    expect(mockGetAllOrders).toHaveBeenCalledWith('2026-07-01');

    const byKey = new Map<string, any>(json.methods.map((m: any) => [m.gateway_name, m]));

    expect(byKey.get('paypal express')).toMatchObject({
      display_name: 'paypal express',
      order_count: 2,
      example_order: '#1001',
    });
    expect(byKey.get('afterpay')).toMatchObject({
      display_name: 'Afterpay',
      order_count: 1,
      example_order: '#1001',
    });
    expect(byKey.get('shopify payments')).toMatchObject({
      display_name: 'Shopify Payments',
      order_count: 1,
      example_order: '1003',
    });
    expect(byKey.get('manual')).toMatchObject({
      display_name: 'Manual',
      order_count: 1,
      example_order: '104',
    });
    expect(byKey.get('unknown')).toMatchObject({
      display_name: 'Unknown',
      order_count: 1,
      example_order: '105',
    });
  });

  it('falls back to the encrypted token if decrypt throws and defaults syncFrom', async () => {
    mockDecrypt.mockImplementationOnce(() => {
      throw new Error('bad decrypt');
    });
    mockImsQuery.mockResolvedValueOnce([]);
    mockGetAllOrders.mockResolvedValueOnce([]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockShopifyCtor).toHaveBeenCalledWith('my-shop.myshopify.com', 'enc-token');

    const passedSyncFrom = String(mockGetAllOrders.mock.calls[0][0]);
    expect(passedSyncFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns 500 when Shopify fetch fails', async () => {
    mockGetAllOrders.mockRejectedValueOnce(new Error('Shopify down'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Shopify down');
  });
});
