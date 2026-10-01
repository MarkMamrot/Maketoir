import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTransfer, mockRefresh, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTransfer: vi.fn(), mockRefresh: vi.fn(), mockReport: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/purchaseOrderBatchTransfer', () => ({ transferPurchaseOrderItemsBatch: mockTransfer }));
vi.mock('@/lib/ims/orderTransfers/purchaseOrderTransfer', () => ({
  PurchaseOrderTransferConflict: class PurchaseOrderTransferConflict extends Error {},
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { PurchaseOrderTransferConflict } from '@/lib/ims/orderTransfers/purchaseOrderTransfer';
import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/purchase-orders/transfers/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/purchase-orders/transfers/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 8, name: 'Alex' });
    mockRefresh.mockResolvedValue(undefined);
    mockReport.mockResolvedValue(undefined);
  });

  it('forwards exact promise selections with session-owned tenant context', async () => {
    mockTransfer.mockResolvedValue({ targetOrderId: 10, sourceOrderIds: [20], variantIds: ['variant-1'] });
    const body = {
      targetOrderId: 10, expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z', operationKey: 'po-batch-1',
      sources: [{ sourceOrderId: 20, expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z', lines: [{
        sourceItemId: 201, quantity: 3, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }],
      }] }],
    };

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(mockTransfer).toHaveBeenCalledWith({ ...body, businessId: 'biz-1', actorId: 8, actorName: 'Alex' });
    expect(mockRefresh).toHaveBeenCalledWith(['variant-1']);
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const response = await POST(request({ targetOrderId: 10, sources: [] }));
    expect(response.status).toBe(403);
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it('returns stale promise selections as conflicts without runtime reporting', async () => {
    mockTransfer.mockRejectedValue(new PurchaseOrderTransferConflict('A selected customer promise changed.'));
    const response = await POST(request({ targetOrderId: 10, operationKey: 'po-batch-1', sources: [{
      sourceOrderId: 20, lines: [{ sourceItemId: 201, quantity: 1, allocations: [] }],
    }] }));
    expect(response.status).toBe(409);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
