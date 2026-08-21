import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSession,
  mockGet,
  mockUpdate,
  mockChangeStatus,
  mockDelete,
  mockXeroSync,
  mockXeroUpdate,
  mockXeroVoid,
  mockGetXeroInvoiceEditState,
  mockRecordXeroReconciliationIssue,
  mockReportRuntimeIssue,
  mockGetOrderActivityHistory,
  mockGetOrderResolutionFinancialSummaries,
  mockImsQuery,
} = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockChangeStatus: vi.fn(),
  mockDelete: vi.fn(),
  mockXeroSync: vi.fn(),
  mockXeroUpdate: vi.fn(),
  mockXeroVoid: vi.fn(),
  mockGetXeroInvoiceEditState: vi.fn(),
  mockRecordXeroReconciliationIssue: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockGetOrderActivityHistory: vi.fn(),
  mockGetOrderResolutionFinancialSummaries: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mockGet, update: mockUpdate, changeStatus: mockChangeStatus, delete: mockDelete },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerSOXeroSync: mockXeroSync,
  triggerSOXeroVoid: mockXeroVoid,
  triggerSOXeroUpdate: mockXeroUpdate,
}));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceEditState: mockGetXeroInvoiceEditState }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mockRecordXeroReconciliationIssue }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/lib/ims/orderAmendmentHistory', () => ({ getOrderActivityHistory: mockGetOrderActivityHistory }));
vi.mock('@/lib/ims/orderResolution/financialSummary', () => ({ getOrderResolutionFinancialSummaries: mockGetOrderResolutionFinancialSummaries }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { DELETE, GET, PUT } from '../route';

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
    mockChangeStatus.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockXeroSync.mockResolvedValue(null);
    mockXeroUpdate.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mockXeroVoid.mockResolvedValue(null);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
    mockRecordXeroReconciliationIssue.mockResolvedValue(9);
    mockGetOrderActivityHistory.mockResolvedValue([]);
    mockGetOrderResolutionFinancialSummaries.mockResolvedValue([]);
    mockImsQuery.mockResolvedValue([]);
  });

  it('includes completed amendment history in SO detail', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [] });
    mockGetOrderActivityHistory.mockResolvedValue([{ id: 8, previousStatus: 'draft', resultingStatus: 'confirmed' }]);

    const response = await GET(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        activity_history: [{ id: 8, previousStatus: 'draft', resultingStatus: 'confirmed' }],
        amendment_history: [{ id: 8, previousStatus: 'draft', resultingStatus: 'confirmed' }],
      },
    });
    expect(mockGetOrderActivityHistory).toHaveBeenCalledWith('biz-1', 'sales_order', 42);
  });

  it('returns core SO detail when optional shortfall financials fail', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', so_type: 'online', items: [{ id: 1 }] });
    mockGetOrderResolutionFinancialSummaries.mockRejectedValue(new Error('Illegal mix of collations'));

    const response = await GET(new Request('http://localhost'), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: { id: 42, status: 'fulfilled', saleType: 'online', resolution_financials: [] },
      warning: 'Shortfall financial details are temporarily unavailable. The sales order can still be viewed.',
    });
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'load_resolution_financials',
      reference: { type: 'sales_order', id: '42' },
    }));
  });

  it('loads Shopify shipment item names from product tables', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', so_type: 'online', items: [] });
    mockImsQuery
      .mockResolvedValueOnce([{ id: 100, shopify_fulfilment_id: 'f-1', status: 'success' }])
      .mockResolvedValueOnce([{ shipment_id: 100, shopify_line_item_id: 'li-1', quantity: 2, sku: 'SKU-1', product_name: 'Tee', variant_label: 'Blue / M' }])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost'), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.shipments[0].items[0]).toMatchObject({
      sku: 'SKU-1', product_name: 'Tee', variant_label: 'Blue / M', quantity: 2,
    });
    const shipmentItemSql = String(mockImsQuery.mock.calls[1][0]);
    expect(shipmentItemSql).toContain('LEFT JOIN ims_product_variants v');
    expect(shipmentItemSql).toContain('LEFT JOIN ims_products p');
    expect(shipmentItemSql).not.toContain('soi.product_name');
  });

  it('requires the quantity-aware fulfilment route to complete a confirmed SO', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [{ variant_id: 'v-1' }] });
    const statusRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'fulfilled' }),
    });

    const response = await PUT(statusRequest, params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'order_lifecycle_conflict',
      error: 'Use Fulfil to record shipment quantities before completing a sales order.',
    });
    expect(mockChangeStatus).not.toHaveBeenCalled();
    expect(mockXeroSync).not.toHaveBeenCalled();
  });

  it('requires Continue Fulfilment or Resolve Outstanding for a partial SO', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'partially_fulfilled', items: [{ variant_id: 'v-1' }] });
    const statusRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
    });

    const response = await PUT(statusRequest, params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'order_lifecycle_conflict',
      error: 'Use Continue Fulfilment or Resolve Outstanding for a partially fulfilled sales order.',
    });
    expect(mockChangeStatus).not.toHaveBeenCalled();
    expect(mockXeroVoid).not.toHaveBeenCalled();
  });

  it('allows an in-progress SO to be explicitly marked complete', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'partially_fulfilled', items: [] });
    const statusRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'fulfilled' }),
    });

    const response = await PUT(statusRequest, params);

    expect(response.status).toBe(200);
    expect(mockChangeStatus).toHaveBeenCalledWith(
      42, 'fulfilled', null, expect.objectContaining({ requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
    expect(mockXeroSync).toHaveBeenCalledWith('biz-1', 42, 'fulfilled');
  });

  it('forwards the loaded revision to an allowed SO status transaction', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', items: [] });
    const statusRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', expectedUpdatedAt: '2026-08-11T10:00:00.000Z' }),
    });

    const response = await PUT(statusRequest, params);

    expect(response.status).toBe(200);
    expect(mockChangeStatus).toHaveBeenCalledWith(
      42, 'cancelled', '2026-08-11T10:00:00.000Z',
      expect.objectContaining({ requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
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

  it('does not allow an Admin reason to bypass a settled Xero invoice', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed', customer_id: 3, xero_invoice_id: 'xero-invoice-1', items: [] });
    mockGetXeroInvoiceEditState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 25, amountCredited: 0, documentDate: '2026-08-09',
    });
    const financialRequest = new Request('http://localhost/api/ims/sales-orders/42', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: 4, xeroOverrideReason: 'Bookkeeper approved correction' }),
    });

    const response = await PUT(financialRequest, params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'settled' });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockXeroUpdate).not.toHaveBeenCalled();
    expect(mockRecordXeroReconciliationIssue).not.toHaveBeenCalled();
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
