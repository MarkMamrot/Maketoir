import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSession,
  mockFulfil,
  mockRefresh,
  mockXeroSync,
  mockReport,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFulfil: vi.fn(),
  mockRefresh: vi.fn(),
  mockXeroSync: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetSession }));
vi.mock('@/lib/ims/orderResolution/customerFulfilment', () => ({ fulfilSalesOrderPartial: mockFulfil }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSOXeroSync: mockXeroSync }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { POST } from '../route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/ims/sales-orders/42/fulfil', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST sales order fulfilment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ businessId: 'biz-1' });
    mockRefresh.mockResolvedValue(undefined);
    mockXeroSync.mockResolvedValue(null);
  });

  it('does not approve the Xero invoice for a partial shipment', async () => {
    mockFulfil.mockResolvedValue({
      soId: 42,
      status: 'partially_fulfilled',
      operationKey: 'shipment-1',
      fulfilledVariantIds: ['variant-1'],
    });

    const response = await POST(request({
      operationKey: 'shipment-1', shipmentQuantities: [{ itemId: 10, quantity: 7 }],
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockFulfil).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', soId: 42 }));
    expect(mockRefresh).toHaveBeenCalledWith(['variant-1']);
    expect(mockXeroSync).not.toHaveBeenCalled();
  });

  it('approves the Xero invoice only after the final shipment', async () => {
    mockFulfil.mockResolvedValue({
      soId: 42,
      status: 'fulfilled',
      operationKey: 'shipment-2',
      fulfilledVariantIds: ['variant-1'],
    });

    const response = await POST(request({
      operationKey: 'shipment-2', shipmentQuantities: [{ itemId: 10, quantity: 3 }],
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockXeroSync).toHaveBeenCalledWith('biz-1', 42, 'fulfilled');
  });

  it('reports unexpected operational failures', async () => {
    mockFulfil.mockRejectedValue(new Error('Database connection lost'));

    const response = await POST(request({
      operationKey: 'shipment-3', shipmentQuantities: [{ itemId: 10, quantity: 1 }],
    }), { params: { id: '42' } });

    expect(response.status).toBe(500);
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'partial_fulfilment',
    }));
  });
});