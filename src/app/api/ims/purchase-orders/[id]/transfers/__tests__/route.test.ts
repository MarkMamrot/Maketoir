import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTransfer, mockRefresh } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTransfer: vi.fn(), mockRefresh: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/purchaseOrderTransfer', () => {
  class PurchaseOrderTransferConflict extends Error {}
  return { PurchaseOrderTransferConflict, transferPurchaseOrderItems: mockTransfer };
});
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/purchase-orders/10/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/purchase-orders/[id]/transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 8, name: 'Alex' });
    mockTransfer.mockResolvedValue({ variantIds: ['variant-1'], movedLines: [] });
    mockRefresh.mockResolvedValue(undefined);
  });

  it('forwards exact customer-promise selections with tenant context', async () => {
    const response = await POST(request({
      targetOrderId: 20, operationKey: 'move-po-1',
      lines: [{ sourceItemId: 101, quantity: 4,
        allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    }), { params: { id: '10' } });
    expect(response.status).toBe(200);
    expect(mockTransfer).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', sourceOrderId: 10, targetOrderId: 20,
      lines: [{ sourceItemId: 101, quantity: 4,
        allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    }));
    expect(mockRefresh).toHaveBeenCalledWith(['variant-1']);
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({}), { params: { id: '10' } })).status).toBe(403);
    expect(mockTransfer).not.toHaveBeenCalled();
  });
});