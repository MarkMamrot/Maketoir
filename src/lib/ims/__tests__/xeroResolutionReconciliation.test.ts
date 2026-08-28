import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  getPolicy: vi.fn(),
  getCustomerCredit: vi.fn(),
  getSupplierCredit: vi.fn(),
  getSalesOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  syncCustomerCredit: vi.fn(),
  syncSupplierCredit: vi.fn(),
  approveCredit: vi.fn(),
  refundCredit: vi.fn(),
  updateInvoice: vi.fn(),
  updateBill: vi.fn(),
  assertXeroAccountingEnabled: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.imsQuery,
  imsExecute: mocks.imsExecute,
}));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({ getXeroDocumentPolicy: mocks.getPolicy }));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertXeroAccountingEnabled: mocks.assertXeroAccountingEnabled,
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsCNRepo: { get: mocks.getCustomerCredit },
  ImsSupplierCNRepo: { get: mocks.getSupplierCredit },
  ImsSORepo: { get: mocks.getSalesOrder },
  ImsPORepo: { get: mocks.getPurchaseOrder },
}));
vi.mock('@/services/XeroSyncService', () => ({
  syncCNAsCreditNote: mocks.syncCustomerCredit,
  syncSupplierCNAsCreditNote: mocks.syncSupplierCredit,
  approveCreditNote: mocks.approveCredit,
  refundXeroCreditNote: mocks.refundCredit,
  updateXeroDraftInvoice: mocks.updateInvoice,
  updateXeroDraftBill: mocks.updateBill,
}));

import { reconcileOrderResolution } from '../orderResolution/xeroReconciliation';

const resolution = {
  id: 7,
  operation_key: 'op-7',
  source_order_id: 11,
  credit_note_id: 21,
  accounting_action: 'credit_note',
  state: 'failed',
};
const settlement = {
  id: 31,
  action_key: 'op-7:refund',
  action_type: 'refund',
  amount: 44,
  account_code: '090',
  status: 'failed',
};

describe('order resolution Xero reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertXeroAccountingEnabled.mockResolvedValue(undefined);
    mocks.imsQuery.mockResolvedValueOnce([resolution]).mockResolvedValueOnce([settlement]);
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.getPolicy.mockResolvedValue({ shortfallCreditDraftFirst: false });
    mocks.getCustomerCredit.mockResolvedValue({ id: 21, cn_number: 'CN-21' });
    mocks.syncCustomerCredit.mockResolvedValue('xero-cn-21');
    mocks.approveCredit.mockResolvedValue(true);
    mocks.refundCredit.mockResolvedValue('payment-1');
  });

  it('rejects disabled tenants before loading or claiming a resolution', async () => {
    mocks.assertXeroAccountingEnabled.mockRejectedValueOnce(new Error('Xero accounting is disabled.'));

    await expect(reconcileOrderResolution({ businessId: 'biz-1', side: 'customer', resolutionId: 7 }))
      .rejects.toThrow('Xero accounting is disabled.');
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('replays only the unfinished customer refund with its persisted account and operation key', async () => {
    const result = await reconcileOrderResolution({ businessId: 'biz-1', side: 'customer', resolutionId: 7 });

    expect(mocks.refundCredit).toHaveBeenCalledWith(expect.objectContaining({
      creditNoteId: 'xero-cn-21',
      amount: 44,
      accountCode: '090',
      actionKey: 'op-7:refund',
    }));
    expect(result).toEqual({ state: 'complete', xeroCreditNoteId: 'xero-cn-21' });
  });

  it('creates a Draft and waits for review without refunding when Draft-first is enabled', async () => {
    mocks.getPolicy.mockResolvedValue({ shortfallCreditDraftFirst: true });

    const result = await reconcileOrderResolution({ businessId: 'biz-1', side: 'customer', resolutionId: 7 });

    expect(mocks.syncCustomerCredit).toHaveBeenCalledWith('biz-1', expect.anything(), 'DRAFT');
    expect(mocks.approveCredit).not.toHaveBeenCalled();
    expect(mocks.refundCredit).not.toHaveBeenCalled();
    expect(result).toEqual({ state: 'awaiting_review', xeroCreditNoteId: 'xero-cn-21' });
  });

  it('refuses a retry when another process owns the resolution claim', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 0 });

    await expect(reconcileOrderResolution({ businessId: 'biz-1', side: 'customer', resolutionId: 7 }))
      .rejects.toThrow('already being processed');
    expect(mocks.syncCustomerCredit).not.toHaveBeenCalled();
  });
});
