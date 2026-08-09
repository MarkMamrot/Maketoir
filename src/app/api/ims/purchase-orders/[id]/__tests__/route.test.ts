import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession,
  mockGet,
  mockUpdate,
  mockChangeStatus,
  mockDelete,
  mockImsQuery,
  mockRefreshVariantCache,
  mockTriggerPOXeroSync,
  mockTriggerPOXeroVoid,
  mockTriggerPOXeroUpdate,
  mockReportRuntimeIssue,
  mockGetXeroInvoiceStatus,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockChangeStatus: vi.fn(),
  mockDelete: vi.fn(),
  mockImsQuery: vi.fn(),
  mockRefreshVariantCache: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockTriggerPOXeroVoid: vi.fn(),
  mockTriggerPOXeroUpdate: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockGetXeroInvoiceStatus: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: {
    get: mockGet,
    update: mockUpdate,
    changeStatus: mockChangeStatus,
    delete: mockDelete,
  },
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefreshVariantCache }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerPOXeroSync: mockTriggerPOXeroSync,
  triggerPOXeroVoid: mockTriggerPOXeroVoid,
  triggerPOXeroUpdate: mockTriggerPOXeroUpdate,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceStatus: mockGetXeroInvoiceStatus }));

import { DELETE, PUT } from '../route';

const params = { params: { id: '42' } };

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/ims/purchase-orders/42', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/ims/purchase-orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockImsQuery.mockResolvedValue([]);
    mockTriggerPOXeroVoid.mockResolvedValue(null);
    mockChangeStatus.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockUpdate.mockResolvedValue(undefined);
    mockTriggerPOXeroUpdate.mockResolvedValue(undefined);
  });

  it('only hard-deletes a draft PO for the authenticated business', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', items: [] });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(42, 'biz-1');
    expect(mockTriggerPOXeroVoid).toHaveBeenCalledWith('biz-1', 42);
  });

  it('rejects hard deletion after a PO has entered the stock lifecycle', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', items: [] });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Only draft purchase orders can be deleted. Cancel confirmed orders or reverse received stock instead.',
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockTriggerPOXeroVoid).not.toHaveBeenCalled();
  });

  it('prevents Advisor accounts from deleting POs', async () => {
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns a conflict when received stock is unavailable for reversal', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', items: [] });
    mockChangeStatus.mockRejectedValue(new Error(
      'Cannot reverse PO receipt: variant variant-1 has 2 units at the receiving location, but 5 received units must be reversed. Return or adjust the stock first.',
    ));

    const response = await PUT(putRequest({ status: 'cancelled' }), params);

    expect(response.status).toBe(409);
    expect(mockChangeStatus).toHaveBeenCalledWith(42, 'cancelled', 'expense', {
      includeLandedCosts: true,
      includeFreight: false,
    });
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('blocks edits when a completed PO has an Authorised Xero bill', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceStatus.mockResolvedValue('AUTHORISED');

    const response = await PUT(putRequest({ notes: 'changed' }), params);

    expect(response.status).toBe(409);
    expect(mockGetXeroInvoiceStatus).toHaveBeenCalledWith('biz-1', 'xero-bill-1');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTriggerPOXeroUpdate).not.toHaveBeenCalled();
  });

  it('allows edits when a completed PO Xero bill is still Draft', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceStatus.mockResolvedValue('DRAFT');

    const response = await PUT(putRequest({ notes: 'changed' }), params);

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockTriggerPOXeroUpdate).toHaveBeenCalledWith('biz-1', 42);
  });
});