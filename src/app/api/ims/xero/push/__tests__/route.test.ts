import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession,
  mockTriggerPOXeroSync,
  mockTriggerSOXeroSync,
  mockTriggerCNXeroSync,
  mockTriggerSupplierCNXeroSync,
  mockTriggerPOPaymentXeroSync,
  mockTriggerSOPaymentXeroSync,
  mockSyncGiftCardIssueInvoice,
  mockSyncGiftCardRedemptionReclass,
  mockSyncStoreCreditIssueReclass,
  mockSyncStoreCreditRedemptionReclass,
  mockImsQuery,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockTriggerSOXeroSync: vi.fn(),
  mockTriggerCNXeroSync: vi.fn(),
  mockTriggerSupplierCNXeroSync: vi.fn(),
  mockTriggerPOPaymentXeroSync: vi.fn(),
  mockTriggerSOPaymentXeroSync: vi.fn(),
  mockSyncGiftCardIssueInvoice: vi.fn(),
  mockSyncGiftCardRedemptionReclass: vi.fn(),
  mockSyncStoreCreditIssueReclass: vi.fn(),
  mockSyncStoreCreditRedemptionReclass: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({
  getImsSession: mockGetImsSession,
}));

vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerPOXeroSync: mockTriggerPOXeroSync,
  triggerSOXeroSync: mockTriggerSOXeroSync,
  triggerCNXeroSync: mockTriggerCNXeroSync,
  triggerSupplierCNXeroSync: mockTriggerSupplierCNXeroSync,
  triggerPOPaymentXeroSync: mockTriggerPOPaymentXeroSync,
  triggerSOPaymentXeroSync: mockTriggerSOPaymentXeroSync,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
}));

vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
}));

vi.mock('@/services/XeroSyncService', () => ({
  syncGiftCardIssueInvoice: mockSyncGiftCardIssueInvoice,
  syncGiftCardRedemptionReclass: mockSyncGiftCardRedemptionReclass,
  syncStoreCreditIssueReclass: mockSyncStoreCreditIssueReclass,
  syncStoreCreditRedemptionReclass: mockSyncStoreCreditRedemptionReclass,
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ims/xero/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/xero/push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mockTriggerPOXeroSync.mockResolvedValue(undefined);
    mockTriggerSOXeroSync.mockResolvedValue(undefined);
    mockTriggerCNXeroSync.mockResolvedValue(undefined);
    mockTriggerSupplierCNXeroSync.mockResolvedValue(undefined);
    mockTriggerPOPaymentXeroSync.mockResolvedValue(undefined);
    mockTriggerSOPaymentXeroSync.mockResolvedValue(undefined);
    mockSyncGiftCardIssueInvoice.mockResolvedValue('xero-gci-1');
    mockSyncGiftCardRedemptionReclass.mockResolvedValue('xero-gcr-1');
    mockSyncStoreCreditIssueReclass.mockResolvedValue('xero-sci-1');
    mockSyncStoreCreditRedemptionReclass.mockResolvedValue('xero-scr-1');
    mockImsQuery.mockResolvedValue([]);
    mockQuery.mockResolvedValue([]);
  });

  it('returns 401 when IMS session is missing', async () => {
    mockGetImsSession.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ type: 'cn', id: 11 }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
  });

  it('blocks Advisor from retrying Xero side effects', async () => {
    mockGetImsSession.mockResolvedValueOnce({ businessId: 'biz-1', tier: 'Advisor' });

    const res = await POST(makeRequest({ type: 'po', id: 11 }));

    expect(res.status).toBe(403);
    expect(mockTriggerPOXeroSync).not.toHaveBeenCalled();
  });

  it('skips CN retry when already synced with stored Xero id', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { xero_sync_status: 'synced', xero_credit_note_id: 'xero-cn-1' },
    ]);

    const res = await POST(makeRequest({ type: 'cn', id: 12 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, skipped: true, reason: 'already_synced' });
    expect(mockTriggerCNXeroSync).not.toHaveBeenCalled();
  });

  it('triggers CN sync when lock acquired and note is not already synced', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ xero_sync_status: 'queued', xero_credit_note_id: null }])
      .mockResolvedValueOnce([{ xero_sync_status: 'synced', xero_credit_note_id: 'xero-cn-13' }]);

    const res = await POST(makeRequest({ type: 'cn', id: 13 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'synced', xeroId: 'xero-cn-13' });
    expect(mockTriggerCNXeroSync).toHaveBeenCalledWith('biz-1', 13);
  });

  it('returns the actual queued result when a PO retry does not sync', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ status: 'complete', supplier_invoice_number: 'N68821' }])
      .mockResolvedValueOnce([{ xero_sync_status: 'queued', xero_bill_id: null }]);

    const res = await POST(makeRequest({ type: 'po', id: 4860 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, status: 'queued', xeroId: null });
    expect(mockTriggerPOXeroSync).toHaveBeenCalledWith('biz-1', 4860, 'complete');
  });

  it('offers a suffix when Xero reports the same invoice number is not modifiable', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ status: 'complete', supplier_invoice_number: 'N68821' }])
      .mockResolvedValueOnce([{ xero_sync_status: 'queued', xero_bill_id: null }]);
    mockQuery
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{
        detail: `Xero API POST /Invoices failed (400): ${JSON.stringify({
          Elements: [{
            InvoiceID: 'voided-bill',
            InvoiceNumber: 'N68821',
            ValidationErrors: [{ Message: 'Invoice not of valid status for modification' }],
          }],
        })}`,
      }]);

    const res = await POST(makeRequest({ type: 'po', id: 4860 }));

    expect(await res.json()).toEqual(expect.objectContaining({
      success: false,
      recovery: expect.objectContaining({
        type: 'invoice_number_conflict',
        originalInvoiceNumber: 'N68821',
        suggestedSuffix: '-R',
        suggestedInvoiceNumber: 'N68821-R',
      }),
    }));
  });

  it('retries with a validated Xero-only invoice number suffix', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ status: 'complete', supplier_invoice_number: 'N68821' }])
      .mockResolvedValueOnce([{ xero_sync_status: 'synced', xero_bill_id: 'replacement-bill' }]);

    const res = await POST(makeRequest({ type: 'po', id: 4860, invoiceNumberSuffix: '-R' }));

    expect(await res.json()).toEqual({ success: true, status: 'synced', xeroId: 'replacement-bill' });
    expect(mockTriggerPOXeroSync).toHaveBeenCalledWith('biz-1', 4860, 'complete', 'N68821-R');
  });

  it('rejects an unsafe invoice number suffix', async () => {
    mockImsQuery.mockResolvedValueOnce([{ status: 'complete', supplier_invoice_number: 'N68821' }]);

    const res = await POST(makeRequest({ type: 'po', id: 4860, invoiceNumberSuffix: '../R' }));

    expect(res.status).toBe(400);
    expect(mockTriggerPOXeroSync).not.toHaveBeenCalled();
  });

  it('replays an SO payment only after tenant payment ownership is verified', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 44 }]);

    const res = await POST(makeRequest({ type: 'so_payment', id: 44, parentId: 9 }));

    expect(res.status).toBe(200);
    expect(mockTriggerSOPaymentXeroSync).toHaveBeenCalledWith('biz-1', 9, 44);
  });

  it('returns 404 instead of replaying a mismatched PO payment', async () => {
    mockImsQuery.mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ type: 'po_payment', id: 45, parentId: 10 }));

    expect(res.status).toBe(404);
    expect(mockTriggerPOPaymentXeroSync).not.toHaveBeenCalled();
  });

  it('applies the same lock/idempotency flow for SCN retries', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ xero_sync_status: 'error', xero_credit_note_id: null }])
      .mockResolvedValueOnce([{ xero_sync_status: 'queued', xero_credit_note_id: null }]);

    const res = await POST(makeRequest({ type: 'scn', id: 21 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, status: 'queued', xeroId: null });
    expect(mockTriggerSupplierCNXeroSync).toHaveBeenCalledWith('biz-1', 21);
  });

  it('replays gift card redemption retry by transaction id', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { id: 17, amount: '22.50', tx_date: '2026-07-25', location_id: 4 },
    ]);

    const res = await POST(makeRequest({ type: 'gift_card_redeem', id: 17 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockSyncGiftCardRedemptionReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      amount: 22.5,
      date: '2026-07-25',
      channel: 'pos',
      locationId: 4,
      dedupeKey: 'gift card redeem tx 17',
      referenceId: 17,
    }));
  });

  it('replays store credit issue retry by transaction id', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { id: 31, type: 'issue', amount: '15.00', tx_date: '2026-07-24', location_id: 2 },
    ]);

    const res = await POST(makeRequest({ type: 'store_credit_issue', id: 31 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockSyncStoreCreditIssueReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      amount: 15,
      date: '2026-07-24',
      channel: 'pos',
      locationId: 2,
      dedupeKey: 'store credit issue tx 31',
      referenceId: 31,
    }));
  });
});
