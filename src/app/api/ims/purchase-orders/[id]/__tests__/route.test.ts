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
  mockGetXeroInvoiceEditState,
  mockRecordXeroReconciliationIssue,
  mockGetOrderResolutionFinancialSummaries,
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
  mockGetXeroInvoiceEditState: vi.fn(),
  mockRecordXeroReconciliationIssue: vi.fn(),
  mockGetOrderResolutionFinancialSummaries: vi.fn(),
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
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceEditState: mockGetXeroInvoiceEditState }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mockRecordXeroReconciliationIssue }));
vi.mock('@/lib/ims/orderResolution/financialSummary', () => ({ getOrderResolutionFinancialSummaries: mockGetOrderResolutionFinancialSummaries }));

import { DELETE, GET, PUT } from '../route';
import { OrderLifecycleConflict } from '@/lib/ims/orderLifecyclePolicy';

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
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mockImsQuery.mockResolvedValue([]);
    mockTriggerPOXeroVoid.mockResolvedValue(null);
    mockChangeStatus.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockUpdate.mockResolvedValue(undefined);
    mockTriggerPOXeroUpdate.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mockRecordXeroReconciliationIssue.mockResolvedValue(9);
    mockGetOrderResolutionFinancialSummaries.mockResolvedValue([]);
  });

  it('returns core PO detail when optional shortfall financials fail', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [{ id: 1 }] });
    mockGetOrderResolutionFinancialSummaries.mockRejectedValue(new Error('Illegal mix of collations'));

    const response = await GET(new Request('http://localhost?include=resolutionFinancials'), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: { id: 42, status: 'confirmed', resolution_financials: [] },
      warning: 'Shortfall financial details are temporarily unavailable. The purchase order can still be viewed and received.',
    });
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'load_resolution_financials',
      reference: { type: 'purchase_order', id: '42' },
    }));
  });

  it('skips shortfall financials for ordinary PO detail requests', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [{ id: 1 }] });

    const response = await GET(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(mockGetOrderResolutionFinancialSummaries).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: 42, resolution_financials: [] },
    });
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
    }, null);
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('forwards the loaded revision to the PO status transaction', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [] });

    const response = await PUT(putRequest({
      status: 'cancelled', expectedUpdatedAt: '2026-08-11T10:00:00.000Z',
    }), params);

    expect(response.status).toBe(200);
    expect(mockChangeStatus).toHaveBeenCalledWith(42, 'cancelled', 'expense', {
      includeLandedCosts: true,
      includeFreight: false,
    }, '2026-08-11T10:00:00.000Z');
  });

  it('returns a structured conflict for a retired direct receipt transition', async () => {
    mockChangeStatus.mockRejectedValue(new OrderLifecycleConflict(
      'Purchase order cannot change from partially_received to confirmed.',
    ));

    const response = await PUT(putRequest({ status: 'confirmed' }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Purchase order cannot change from partially_received to confirmed.',
      code: 'order_lifecycle_conflict',
    });
    expect(mockTriggerPOXeroSync).not.toHaveBeenCalled();
    expect(mockTriggerPOXeroVoid).not.toHaveBeenCalled();
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('does not contact Xero for local-only edits', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', supplier_id: 3, xero_bill_id: 'xero-bill-1', items: [] });

    const response = await PUT(putRequest({ notes: 'changed' }), params);

    expect(response.status).toBe(200);
    expect(mockGetXeroInvoiceEditState).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockTriggerPOXeroUpdate).not.toHaveBeenCalled();
  });

  it('updates an unpaid Authorised bill after a Xero-visible edit', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', supplier_id: 3, xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, documentDate: '2026-08-09', periodLockDate: '2026-06-30',
    });

    const response = await PUT(putRequest({ supplier_id: 4 }), params);

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockTriggerPOXeroUpdate).toHaveBeenCalledWith('biz-1', 42);
  });

  it('blocks a settled Xero-visible edit and directs the user to correction', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', supplier_id: 3, xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 10, amountCredited: 0, documentDate: '2026-08-09',
    });

    const response = await PUT(putRequest({ supplier_id: 4 }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'settled' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not allow an Admin reason to bypass a terminal Xero document', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'complete', supplier_id: 3, xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'PAID', amountPaid: 25, amountCredited: 0, documentDate: '2026-08-09',
    });

    const response = await PUT(putRequest({ supplier_id: 4, xeroOverrideReason: 'Bookkeeper approved correction' }), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ code: 'terminal_status' });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTriggerPOXeroUpdate).not.toHaveBeenCalled();
    expect(mockRecordXeroReconciliationIssue).not.toHaveBeenCalled();
  });

  it('returns and records a warning when the post-save Xero update fails', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', supplier_id: 3, xero_bill_id: 'xero-bill-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'DRAFT', amountPaid: 0, amountCredited: 0, documentDate: '2026-08-09',
    });
    mockTriggerPOXeroUpdate.mockResolvedValue({ attempted: true, updated: false, warning: 'Saved, but Xero failed.' });

    const response = await PUT(putRequest({ supplier_id: 4 }), params);

    expect(await response.json()).toMatchObject({ success: true, xeroWarning: 'Saved, but Xero failed.' });
    expect(mockRecordXeroReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({ ruleKey: 'post_edit_sync_failed' }));
  });
});