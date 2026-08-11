import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSession,
  mockGet,
  mockUpdate,
  mockDelete,
  mockXeroUpdate,
  mockXeroVoid,
  mockGetXeroInvoiceEditState,
  mockRecordXeroReconciliationIssue,
  mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockXeroUpdate: vi.fn(),
  mockXeroVoid: vi.fn(),
  mockGetXeroInvoiceEditState: vi.fn(),
  mockRecordXeroReconciliationIssue: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mockGet, update: mockUpdate, delete: mockDelete },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerSOXeroSync: vi.fn(),
  triggerSOXeroVoid: mockXeroVoid,
  triggerSOXeroUpdate: mockXeroUpdate,
}));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceEditState: mockGetXeroInvoiceEditState }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mockRecordXeroReconciliationIssue }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { DELETE, PUT } from '../route';

const params = { params: { id: '42' } };
const request = () => new Request('http://localhost/api/ims/sales-orders/42', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes: 'changed' }),
});

describe('PUT /api/ims/sales-orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockXeroUpdate.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mockXeroVoid.mockResolvedValue(null);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
    mockRecordXeroReconciliationIssue.mockResolvedValue(9);
  });

  it('leaves note-only edits local', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', customer_id: 3, xero_invoice_id: 'xero-invoice-1', items: [] });

    const response = await PUT(request(), params);

    expect(response.status).toBe(200);
    expect(mockGetXeroInvoiceEditState).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockXeroUpdate).not.toHaveBeenCalled();
  });

  it('blocks Xero-visible edits after shipment before contacting Xero', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', customer_id: 3, xero_invoice_id: 'xero-invoice-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, documentDate: '2026-08-09',
    });
    const financialRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: 4 }),
    });

    const response = await PUT(financialRequest, params);

    expect(response.status).toBe(409);
    expect(mockGetXeroInvoiceEditState).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockXeroUpdate).not.toHaveBeenCalled();
  });

  it('returns a conflict without reporting when shipped commercial lines are changed', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', customer_id: 3, xero_invoice_id: null, items: [] });
    const lineEditRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ variant_id: 'new-size', qty_ordered: 1, unit_price: 10 }] }),
    });

    const response = await PUT(lineEditRequest, params);

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/ims/sales-orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockDelete.mockResolvedValue(undefined);
    mockXeroVoid.mockResolvedValue(null);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('deletes a tenant-scoped Draft sales order', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', items: [] });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(mockXeroVoid).toHaveBeenCalledWith('biz-1', 42);
    expect(mockDelete).toHaveBeenCalledWith(42, 'biz-1');
  });

  it('blocks deletion before touching Xero when the sales order is not Draft', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [] });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(409);
    expect(mockXeroVoid).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
