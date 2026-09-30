import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTransfer, mockRefresh, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockTransfer: vi.fn(),
  mockRefresh: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/salesOrderTransfer', () => {
  class SalesOrderTransferConflict extends Error {}
  return { SalesOrderTransferConflict, transferSalesOrderItems: mockTransfer };
});
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { SalesOrderTransferConflict } from '@/lib/ims/orderTransfers/salesOrderTransfer';
import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/sales-orders/10/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/sales-orders/[id]/transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({
      businessId: 'biz-1', tier: 'Admin', userId: 8, name: 'Alex Example', email: 'alex@example.com',
    });
    mockRefresh.mockResolvedValue(undefined);
    mockReport.mockResolvedValue(undefined);
  });

  it('forwards the session tenant and explicit allocation mix to the atomic service', async () => {
    mockTransfer.mockResolvedValue({
      sourceOrderId: 10, targetOrderId: 20, variantIds: ['variant-1'], movedLines: [],
    });
    const response = await POST(request({
      targetOrderId: 20,
      operationKey: 'move-1',
      expectedSourceUpdatedAt: '2026-04-01T00:00:00.000Z',
      expectedTargetUpdatedAt: '2026-04-02T00:00:00.000Z',
      lines: [{ sourceItemId: 101, quantity: 2.5, allocatedIncomingQuantity: 1.25 }],
    }), { params: { id: '10' } });

    expect(response.status).toBe(200);
    expect(mockTransfer).toHaveBeenCalledWith({
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: 20,
      createTarget: false,
      operationKey: 'move-1',
      expectedSourceUpdatedAt: '2026-04-01T00:00:00.000Z',
      expectedTargetUpdatedAt: '2026-04-02T00:00:00.000Z',
      lines: [{ sourceItemId: 101, quantity: 2.5, allocatedIncomingQuantity: 1.25 }],
      actorId: 8,
      actorName: 'Alex Example',
    });
    expect(mockRefresh).toHaveBeenCalledWith(['variant-1']);
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const response = await POST(request({ targetOrderId: 20 }), { params: { id: '10' } });

    expect(response.status).toBe(403);
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it('requests a new destination without accepting a client-supplied order ID', async () => {
    mockTransfer.mockResolvedValue({
      sourceOrderId: 10, targetOrderId: 30, targetOrderNumber: 'SO-2026-0030', variantIds: [], movedLines: [],
    });
    const response = await POST(request({
      destinationMode: 'new',
      targetOrderId: 999,
      operationKey: 'move-new-1',
      expectedSourceUpdatedAt: '2026-04-01T00:00:00.000Z',
      lines: [{ sourceItemId: 101, quantity: 1, allocatedIncomingQuantity: 0.5 }],
    }), { params: { id: '10' } });

    expect(response.status).toBe(200);
    expect(mockTransfer).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: null,
      createTarget: true,
      expectedTargetUpdatedAt: null,
    }));
  });

  it('returns expected stale or compatibility failures as conflicts without runtime reporting', async () => {
    mockTransfer.mockRejectedValue(new SalesOrderTransferConflict('The destination Sales Order changed.'));
    const response = await POST(request({
      targetOrderId: 20,
      operationKey: 'move-1',
      lines: [{ sourceItemId: 101, quantity: 1, allocatedIncomingQuantity: 0 }],
    }), { params: { id: '10' } });

    expect(response.status).toBe(409);
    expect(mockReport).not.toHaveBeenCalled();
  });
});