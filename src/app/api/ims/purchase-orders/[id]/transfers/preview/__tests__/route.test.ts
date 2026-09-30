import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockPreview, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockPreview: vi.fn(), mockReport: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/orderTransfers/purchaseOrderPreview', () => {
  class PurchaseOrderTransferPreviewConflict extends Error {}
  return { PurchaseOrderTransferPreviewConflict, previewPurchaseOrderTransfer: mockPreview };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { GET } from '../route';

describe('GET /api/ims/purchase-orders/[id]/transfers/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockPreview.mockResolvedValue({ source: { id: 10 }, lines: [] });
  });

  it('forwards the authenticated tenant and source order', async () => {
    const response = await GET(new Request('http://localhost'), { params: { id: '10' } });
    expect(response.status).toBe(200);
    expect(mockPreview).toHaveBeenCalledWith({ businessId: 'biz-1', sourceOrderId: 10 });
  });

  it('requires authentication', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET(new Request('http://localhost'), { params: { id: '10' } })).status).toBe(401);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});