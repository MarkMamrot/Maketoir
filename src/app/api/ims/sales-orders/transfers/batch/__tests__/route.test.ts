import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTransfer, mockRefresh, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockTransfer: vi.fn(),
  mockRefresh: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/salesOrderBatchTransfer', () => ({
  transferSalesOrderItemsBatch: mockTransfer,
}));
vi.mock('@/lib/ims/orderTransfers/salesOrderTransfer', () => {
  class SalesOrderTransferConflict extends Error {}
  return { SalesOrderTransferConflict };
});
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { SalesOrderTransferConflict } from '@/lib/ims/orderTransfers/salesOrderTransfer';
import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/sales-orders/transfers/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/sales-orders/transfers/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({
      businessId: 'biz-1', tier: 'Admin', userId: 8, name: 'Alex Example', email: 'alex@example.com',
    });
    mockRefresh.mockResolvedValue(undefined);
    mockReport.mockResolvedValue(undefined);
  });

  it('forwards tenant-owned exact source quantities to one atomic batch', async () => {
    mockTransfer.mockResolvedValue({
      targetOrderId: 10, sourceOrderIds: [20, 30], variantIds: ['variant-1'], transfers: [],
    });
    const response = await POST(request({
      targetOrderId: 10,
      expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
      operationKey: 'batch-1',
      sources: [{
        sourceOrderId: 20,
        expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z',
        lines: [{ sourceItemId: 201, quantity: 2.5, allocatedIncomingQuantity: 1.25 }],
      }, {
        sourceOrderId: 30,
        expectedSourceUpdatedAt: '2026-09-02T00:00:00.000Z',
        lines: [{ sourceItemId: 301, quantity: 1, allocatedIncomingQuantity: 0 }],
      }],
    }));

    expect(response.status).toBe(200);
    expect(mockTransfer).toHaveBeenCalledWith({
      businessId: 'biz-1',
      targetOrderId: 10,
      expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
      operationKey: 'batch-1',
      sources: [{
        sourceOrderId: 20,
        expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z',
        lines: [{ sourceItemId: 201, quantity: 2.5, allocatedIncomingQuantity: 1.25 }],
      }, {
        sourceOrderId: 30,
        expectedSourceUpdatedAt: '2026-09-02T00:00:00.000Z',
        lines: [{ sourceItemId: 301, quantity: 1, allocatedIncomingQuantity: 0 }],
      }],
      actorId: 8,
      actorName: 'Alex Example',
    });
    expect(mockRefresh).toHaveBeenCalledWith(['variant-1']);
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await POST(request({ targetOrderId: 10, sources: [] }));

    expect(response.status).toBe(403);
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it('returns stale batch plans as conflicts without runtime reporting', async () => {
    mockTransfer.mockRejectedValue(new SalesOrderTransferConflict('Source Sales Order SO-20 changed.'));

    const response = await POST(request({
      targetOrderId: 10,
      operationKey: 'batch-1',
      sources: [{ sourceOrderId: 20, lines: [{ sourceItemId: 201, quantity: 1, allocatedIncomingQuantity: 0 }] }],
    }));

    expect(response.status).toBe(409);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
