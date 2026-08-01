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
  mockUpdateXeroDraftSupplierCreditNote,
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
  mockUpdateXeroDraftSupplierCreditNote: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockConnectionsGet },
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: { get: mockPOGet },
  ImsSORepo: { get: mockSOGet },
  ImsCNRepo: {},
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
  syncCNAsCreditNote: vi.fn(),
  markCNXeroStatus: vi.fn(),
  syncSupplierCNAsCreditNote: vi.fn(),
  markSupplierCNXeroStatus: vi.fn(),
  voidXeroCreditNote: vi.fn(),
  voidXeroSupplierCreditNote: vi.fn(),
  updateXeroDraftSupplierCreditNote: mockUpdateXeroDraftSupplierCreditNote,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));

import {
  triggerPOPaymentXeroSync,
  triggerPOXeroSync,
  triggerSOXeroSync,
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

    const warning = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(warning).toBeNull();
    expect(mockUpdateXeroDraftSupplierCreditNote).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ id: 42, scn_number: 'SCN-00001' }),
      'xero-123',
    );
  });

  it('returns a warning when no Xero draft credit note exists yet', async () => {
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockSupplierCNGet.mockResolvedValue({ id: 42, scn_number: 'SCN-00001', xero_credit_note_id: null, status: 'draft' });

    const warning = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(warning).toContain('not been synced to Xero yet');
    expect(mockUpdateXeroDraftSupplierCreditNote).not.toHaveBeenCalled();
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
