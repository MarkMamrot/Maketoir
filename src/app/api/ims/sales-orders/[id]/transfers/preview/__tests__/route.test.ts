import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockPreview, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockPreview: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/salesOrderPreview', () => {
  class OrderTransferPreviewConflict extends Error {}
  return {
    OrderTransferPreviewConflict,
    previewSalesOrderTransfer: mockPreview,
  };
});
vi.mock('@/lib/ims/stockAllocation/service', () => {
  class StockAllocationConflict extends Error {}
  return { StockAllocationConflict };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import {
  OrderTransferPreviewConflict,
} from '@/lib/ims/orderTransfers/salesOrderPreview';
import { GET } from '../route';

const request = new Request('http://localhost/api/ims/sales-orders/42/transfers/preview');

describe('GET /api/ims/sales-orders/[id]/transfers/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('requires an authenticated IMS session', async () => {
    mockSession.mockResolvedValue(null);
    const response = await GET(request, { params: { id: '42' } });
    expect(response.status).toBe(401);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('rejects invalid source order IDs', async () => {
    const response = await GET(request, { params: { id: 'invalid' } });
    expect(response.status).toBe(400);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('forwards explicit tenant context to the preview service', async () => {
    mockPreview.mockResolvedValue({ source: { id: 42 }, lines: [] });
    const response = await GET(request, { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockPreview).toHaveBeenCalledWith({ businessId: 'biz-1', sourceOrderId: 42 });
    expect(await response.json()).toMatchObject({ success: true, data: { source: { id: 42 } } });
  });

  it('returns expected preview conflicts without reporting an operational failure', async () => {
    mockPreview.mockRejectedValue(new OrderTransferPreviewConflict('Sales order was not found.'));
    const response = await GET(request, { params: { id: '42' } });

    expect(response.status).toBe(409);
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('reports unexpected preview failures with safe tenant context', async () => {
    mockPreview.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(request, { params: { id: '42' } });

    expect(response.status).toBe(500);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'preview_order_transfer',
      reference: { type: 'sales_order', id: '42' },
    }));
  });
});