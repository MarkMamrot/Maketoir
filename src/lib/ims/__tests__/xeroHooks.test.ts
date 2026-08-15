import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectionsGet,
  mockPOGet,
  mockSOGet,
  mockSupplierCNGet,
  mockGetPolicy,
  mockReportRuntimeIssue,
  mockImsQuery,
  mockQuery,
  mockSyncPOAsDraftBill,
  mockUpdateXeroDraftBill,
  mockSyncPOAttachmentsToXero,
  mockApproveBill,
  mockSyncPOReceivedJournal,
  mockSyncPOPayment,
  mockSyncSOAsInvoice,
  mockUpdateXeroDraftInvoice,
  mockApproveInvoice,
  mockUpdateXeroDraftCustomerCreditNote,
  mockUpdateXeroDraftSupplierCreditNote,
  mockCNGet,
  mockSyncCNAsCreditNote,
  mockSyncSupplierCNAsCreditNote,
  mockApproveCreditNote,
} = vi.hoisted(() => ({
  mockConnectionsGet: vi.fn(),
  mockPOGet: vi.fn(),
  mockSOGet: vi.fn(),
  mockSupplierCNGet: vi.fn(),
  mockGetPolicy: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
  mockSyncPOAsDraftBill: vi.fn(),
  mockUpdateXeroDraftBill: vi.fn(),
  mockSyncPOAttachmentsToXero: vi.fn(),
  mockApproveBill: vi.fn(),
  mockSyncPOReceivedJournal: vi.fn(),
  mockSyncPOPayment: vi.fn(),
  mockSyncSOAsInvoice: vi.fn(),
  mockUpdateXeroDraftInvoice: vi.fn(),
  mockApproveInvoice: vi.fn(),
  mockUpdateXeroDraftCustomerCreditNote: vi.fn(),
  mockUpdateXeroDraftSupplierCreditNote: vi.fn(),
  mockCNGet: vi.fn(),
  mockSyncCNAsCreditNote: vi.fn(),
  mockSyncSupplierCNAsCreditNote: vi.fn(),
  mockApproveCreditNote: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockConnectionsGet },
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: { get: mockPOGet },
  ImsSORepo: { get: mockSOGet },
  ImsCNRepo: { get: mockCNGet },
  ImsSupplierCNRepo: { get: mockSupplierCNGet },
}));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({ getXeroDocumentPolicy: mockGetPolicy }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/XeroSyncService', () => ({
  syncPOAsDraftBill: mockSyncPOAsDraftBill,
  syncPOAttachmentsToXero: mockSyncPOAttachmentsToXero,
  updateXeroDraftBill: mockUpdateXeroDraftBill,
  approveBill: mockApproveBill,
  syncPOReceivedJournal: mockSyncPOReceivedJournal,
  syncPOPayment: mockSyncPOPayment,
  syncSOPayment: vi.fn(),
  syncSOAsInvoice: mockSyncSOAsInvoice,
  updateXeroDraftInvoice: mockUpdateXeroDraftInvoice,
  approveInvoice: mockApproveInvoice,
  markPoXeroStatus: vi.fn(),
  markSoXeroStatus: vi.fn(),
  voidXeroBill: vi.fn(),
  voidXeroInvoice: vi.fn(),
  syncCNAsCreditNote: mockSyncCNAsCreditNote,
  markCNXeroStatus: vi.fn(),
  syncSupplierCNAsCreditNote: mockSyncSupplierCNAsCreditNote,
  markSupplierCNXeroStatus: vi.fn(),
  voidXeroCreditNote: vi.fn(),
  voidXeroSupplierCreditNote: vi.fn(),
  updateXeroDraftCustomerCreditNote: mockUpdateXeroDraftCustomerCreditNote,
  updateXeroDraftSupplierCreditNote: mockUpdateXeroDraftSupplierCreditNote,
  approveCreditNote: mockApproveCreditNote,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: vi.fn(), imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));

import {
  triggerPOPaymentXeroSync,
  triggerPOXeroSync,
  triggerSOXeroSync,
  triggerCNXeroUpdate,
  triggerCNXeroSync,
  triggerSupplierCNXeroSync,
  triggerSupplierCNXeroUpdate,
} from '../xeroHooks';
import { DEFAULT_XERO_DOCUMENT_POLICY } from '@/lib/xero/documentPolicies';

describe('triggerSupplierCNXeroUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);
    mockUpdateXeroDraftBill.mockResolvedValue(true);
    mockUpdateXeroDraftInvoice.mockResolvedValue(true);
    mockApproveBill.mockResolvedValue(true);
    mockApproveInvoice.mockResolvedValue(true);
  });

  it('updates the linked draft Xero credit note for an edited supplier credit note', async () => {
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockSupplierCNGet.mockResolvedValue({ id: 42, scn_number: 'SCN-00001', xero_credit_note_id: 'xero-123', status: 'draft' });
    mockUpdateXeroDraftSupplierCreditNote.mockResolvedValue(true);

    const result = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(result).toEqual({ attempted: true, updated: true, warning: null });
    expect(mockUpdateXeroDraftSupplierCreditNote).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ id: 42, scn_number: 'SCN-00001' }),
      'xero-123',
    );
  });

  it('does nothing when no linked Xero credit note exists yet', async () => {
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockSupplierCNGet.mockResolvedValue({ id: 42, scn_number: 'SCN-00001', xero_credit_note_id: null, status: 'draft' });

    const result = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(result).toEqual({ attempted: false, updated: false, warning: null });
    expect(mockUpdateXeroDraftSupplierCreditNote).not.toHaveBeenCalled();
  });

  it('updates the linked Xero Draft for an edited customer credit note', async () => {
    mockCNGet.mockResolvedValue({ id: 41, cn_number: 'CN-00001', xero_credit_note_id: 'xero-122', status: 'draft' });
    mockUpdateXeroDraftCustomerCreditNote.mockResolvedValue(true);

    const result = await triggerCNXeroUpdate('biz-1', 41);

    expect(result).toEqual({ attempted: true, updated: true, warning: null });
    expect(mockUpdateXeroDraftCustomerCreditNote).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ id: 41, cn_number: 'CN-00001' }),
      'xero-122',
    );
  });
});

describe('PO and SO Xero document policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);
    mockUpdateXeroDraftBill.mockResolvedValue(true);
    mockUpdateXeroDraftInvoice.mockResolvedValue(true);
    mockApproveBill.mockResolvedValue(true);
    mockApproveInvoice.mockResolvedValue(true);
  });

  it('does not load or mutate a PO when its status maps to no sync', async () => {
    mockGetPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poApprovedAction: 'none',
    });

    await triggerPOXeroSync('biz-1', 12, 'confirmed');

    expect(mockPOGet).not.toHaveBeenCalled();
    expect(mockSyncPOAsDraftBill).not.toHaveBeenCalled();
  });

  it('does not load Xero configuration for a supplier backorder', async () => {
    await triggerPOXeroSync('biz-1', 12, 'backordered');

    expect(mockConnectionsGet).not.toHaveBeenCalled();
    expect(mockGetPolicy).not.toHaveBeenCalled();
    expect(mockPOGet).not.toHaveBeenCalled();
  });

  it('does not load Xero configuration for a customer backorder', async () => {
    await triggerSOXeroSync('biz-1', 8, 'backordered');

    expect(mockConnectionsGet).not.toHaveBeenCalled();
    expect(mockGetPolicy).not.toHaveBeenCalled();
    expect(mockSOGet).not.toHaveBeenCalled();
  });

  it('reports a policy storage failure and skips Xero mutation', async () => {
    mockGetPolicy.mockRejectedValue(new Error('policy table unavailable'));

    await triggerPOXeroSync('biz-1', 12, 'confirmed');

    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'load_document_policy',
    }));
    expect(mockPOGet).not.toHaveBeenCalled();
    expect(mockSyncPOAsDraftBill).not.toHaveBeenCalled();
  });

  it('updates then authorises an existing SO when configured', async () => {
    const so = { id: 8, so_number: 'SO-00008', xero_invoice_id: 'xero-so-8' };
    mockSOGet.mockResolvedValue(so);
    mockGetPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      soApprovedAction: 'authorised',
    });

    await triggerSOXeroSync('biz-1', 8, 'confirmed');

    expect(mockUpdateXeroDraftInvoice).toHaveBeenCalledWith('biz-1', so, 'xero-so-8');
    expect(mockApproveInvoice).toHaveBeenCalledWith('biz-1', 'xero-so-8', 8);
  });

  it('posts the received journal only after bill authorisation succeeds', async () => {
    mockPOGet.mockResolvedValue({
      id: 12,
      po_number: 'PO-00012',
      xero_bill_id: 'xero-po-12',
      payments: [{ id: 1 }],
      total_amount: 120,
      location_id: 4,
    });
    mockApproveBill.mockResolvedValue(false);

    await triggerPOXeroSync('biz-1', 12, 'complete');

    expect(mockApproveBill).toHaveBeenCalled();
    expect(mockSyncPOReceivedJournal).not.toHaveBeenCalled();
  });

  it('uses a confirmed replacement invoice number only for the Xero sync payload', async () => {
    const po = {
      id: 12,
      po_number: 'PO-00012',
      supplier_invoice_number: 'N68821',
      xero_bill_id: null,
      payments: [],
    };
    mockPOGet.mockResolvedValue(po);
    mockSyncPOAsDraftBill.mockResolvedValue('xero-replacement');

    await triggerPOXeroSync('biz-1', 12, 'confirmed', 'N68821-R');

    expect(mockSyncPOAsDraftBill).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      supplier_invoice_number: 'N68821-R',
    }));
    expect(po.supplier_invoice_number).toBe('N68821');
  });

  it('keeps PO payments local when payment sync is disabled', async () => {
    mockGetPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poPaymentSyncEnabled: false,
    });

    await triggerPOPaymentXeroSync('biz-1', 12, 31);

    expect(mockPOGet).not.toHaveBeenCalled();
    expect(mockSyncPOAsDraftBill).not.toHaveBeenCalled();
    expect(mockApproveBill).not.toHaveBeenCalled();
  });

  it('does not create or authorise a bill for an unmapped payment method', async () => {
    mockPOGet.mockResolvedValue({
      id: 12,
      po_number: 'PO-00012',
      payments: [{ id: 31, payment_method_id: 5, amount: 10, payment_date: '2026-08-01' }],
    });
    mockImsQuery.mockResolvedValue([{ xero_account_code: '' }]);

    await triggerPOPaymentXeroSync('biz-1', 12, 31);

    expect(mockSyncPOAsDraftBill).not.toHaveBeenCalled();
    expect(mockApproveBill).not.toHaveBeenCalled();
    expect(mockSyncPOPayment).not.toHaveBeenCalled();
  });
});

describe('credit note Xero document policies', () => {
  const customerCreditNote = {
    id: 4,
    cn_number: 'CN-00004',
    status: 'complete',
    source: 'manual',
    items: [],
  };
  const supplierCreditNote = {
    id: 5,
    scn_number: 'SCN-00005',
    status: 'complete',
    items: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockSyncCNAsCreditNote.mockResolvedValue('xero-cn-4');
    mockSyncSupplierCNAsCreditNote.mockResolvedValue('xero-scn-5');
  });

  it('keeps manual customer credit notes local when configured as no sync', async () => {
    mockCNGet.mockResolvedValue(customerCreditNote);
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY, manualCustomerCreditNoteAction: 'none' });

    await triggerCNXeroSync('biz-1', 4);

    expect(mockSyncCNAsCreditNote).not.toHaveBeenCalled();
  });

  it('creates a Draft manual customer credit note when configured', async () => {
    mockCNGet.mockResolvedValue(customerCreditNote);
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY, manualCustomerCreditNoteAction: 'draft' });

    await triggerCNXeroSync('biz-1', 4);

    expect(mockSyncCNAsCreditNote).toHaveBeenCalledWith('biz-1', expect.objectContaining({ id: 4 }), 'DRAFT');
  });

  it('never syncs POS credit notes separately', async () => {
    mockCNGet.mockResolvedValue({ ...customerCreditNote, source: 'pos' });

    await triggerCNXeroSync('biz-1', 4);

    expect(mockGetPolicy).not.toHaveBeenCalled();
    expect(mockSyncCNAsCreditNote).not.toHaveBeenCalled();
  });

  it('always creates Shopify credit notes as Authorised', async () => {
    mockCNGet.mockResolvedValue({ ...customerCreditNote, source: 'shopify' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY, manualCustomerCreditNoteAction: 'none' });

    await triggerCNXeroSync('biz-1', 4);

    expect(mockSyncCNAsCreditNote).toHaveBeenCalledWith('biz-1', expect.objectContaining({ id: 4 }), 'AUTHORISED');
  });

  it('promotes a linked supplier Draft when Authorised is configured', async () => {
    mockSupplierCNGet.mockResolvedValue({ ...supplierCreditNote, xero_credit_note_id: 'xero-scn-5' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY, supplierCreditNoteAction: 'authorised' });
    mockUpdateXeroDraftSupplierCreditNote.mockResolvedValue(true);

    await triggerSupplierCNXeroSync('biz-1', 5);

    expect(mockUpdateXeroDraftSupplierCreditNote).toHaveBeenCalled();
    expect(mockApproveCreditNote).toHaveBeenCalledWith('biz-1', 'xero-scn-5', 5, 'scn_credit_note');
  });

  it('does not downgrade a linked customer credit note when Draft is configured', async () => {
    mockCNGet.mockResolvedValue({ ...customerCreditNote, xero_credit_note_id: 'xero-cn-4' });
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY, manualCustomerCreditNoteAction: 'draft' });

    await triggerCNXeroSync('biz-1', 4);

    expect(mockSyncCNAsCreditNote).not.toHaveBeenCalled();
    expect(mockApproveCreditNote).not.toHaveBeenCalled();
  });
});
