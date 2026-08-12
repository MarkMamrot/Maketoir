import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCustomer: vi.fn(),
  getSupplier: vi.fn(),
  resolveCustomer: vi.fn(),
  resolveSupplier: vi.fn(),
  voidCustomer: vi.fn(),
  voidSupplier: vi.fn(),
  getXeroState: vi.fn(),
  reverseCustomer: vi.fn(),
  reverseSupplier: vi.fn(),
  markResult: vi.fn(),
  report: vi.fn(),
}));

vi.mock('../ImsRepository', () => ({
  ImsCNRepo: { get: mocks.getCustomer },
  ImsSupplierCNRepo: { get: mocks.getSupplier },
}));
vi.mock('../xeroHooks', () => ({
  resolveCNXeroCreditNoteId: mocks.resolveCustomer,
  resolveSupplierCNXeroCreditNoteId: mocks.resolveSupplier,
  triggerCNXeroVoid: mocks.voidCustomer,
  triggerSupplierCNXeroVoid: mocks.voidSupplier,
}));
vi.mock('@/services/XeroSyncService', () => ({ getXeroCreditNoteEditState: mocks.getXeroState }));
vi.mock('../creditNotes/creditNoteCorrections', async importOriginal => {
  const actual = await importOriginal<typeof import('../creditNotes/creditNoteCorrections')>();
  return {
    ...actual,
    reverseCustomerCreditNote: mocks.reverseCustomer,
    reverseSupplierCreditNote: mocks.reverseSupplier,
    markCreditNoteCorrectionResult: mocks.markResult,
  };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { executeCreditNoteReversalWorkflow } from '../creditNotes/creditNoteReversalWorkflow';

const context = {
  operationKey: 'stable-key', requestHash: 'request-hash', expectedUpdatedAt: 'revision', actorId: 7, actorName: 'Alex',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCustomer.mockResolvedValue({ id: 12, status: 'complete', source: 'manual' });
  mocks.getSupplier.mockResolvedValue({ id: 15, status: 'complete', currency_code: 'AUD' });
  mocks.resolveCustomer.mockResolvedValue('xero-cn');
  mocks.resolveSupplier.mockResolvedValue('xero-scn');
  mocks.getXeroState.mockResolvedValue({
    status: 'AUTHORISED', total: 25, remainingCredit: 25, documentDate: '2026-08-12',
    periodLockDate: '2026-06-30', endOfYearLockDate: null, currencyCode: 'AUD', contactId: 'contact-1',
  });
  mocks.reverseCustomer.mockResolvedValue({ id: 12, status: 'reversed', replayed: false, xeroCorrectionStatus: 'queued' });
  mocks.reverseSupplier.mockResolvedValue({ id: 15, status: 'reversed', replayed: false, xeroCorrectionStatus: 'queued' });
  mocks.voidCustomer.mockResolvedValue(null);
  mocks.voidSupplier.mockResolvedValue(null);
  mocks.markResult.mockResolvedValue(undefined);
  mocks.report.mockResolvedValue(undefined);
});

describe('executeCreditNoteReversalWorkflow', () => {
  it('blocks an allocated Xero credit before local reversal', async () => {
    mocks.getXeroState.mockResolvedValue({
      status: 'AUTHORISED', total: 25, remainingCredit: 5, documentDate: '2026-08-12',
    });

    await expect(executeCreditNoteReversalWorkflow({
      kind: 'customer_credit_note', businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context,
    })).rejects.toThrow('allocations or refunds applied');

    expect(mocks.reverseCustomer).not.toHaveBeenCalled();
    expect(mocks.voidCustomer).not.toHaveBeenCalled();
  });

  it('preflights, reverses locally, and records a successful Xero correction', async () => {
    const result = await executeCreditNoteReversalWorkflow({
      kind: 'customer_credit_note', businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context,
    });

    expect(mocks.reverseCustomer).toHaveBeenCalledWith(expect.objectContaining({ xeroCorrectionRequired: true }));
    expect(mocks.voidCustomer).toHaveBeenCalledWith('biz-1', 12);
    expect(mocks.markResult).toHaveBeenCalledWith('customer_credit_note', 'biz-1', 12, 'synced', 'xero-cn');
    expect(result.xeroWarning).toBeNull();
  });

  it('keeps local reversal successful and reports a rejected post-commit Xero correction', async () => {
    mocks.voidSupplier.mockResolvedValue('Please void it manually in Xero.');

    const result = await executeCreditNoteReversalWorkflow({
      kind: 'supplier_credit_note', businessId: 'biz-1', documentId: 15, reason: 'Entered twice', context,
    });

    expect(mocks.reverseSupplier).toHaveBeenCalledOnce();
    expect(mocks.markResult).toHaveBeenCalledWith(
      'supplier_credit_note', 'biz-1', 15, 'error', 'xero-scn', 'Please void it manually in Xero.',
    );
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'reversal_xero_void', reference: { type: 'supplier_credit_note', id: 15 },
    }));
    expect(result.xeroWarning).toContain('manually');
  });

  it('skips first-run preflight after local reversal so a retry can recover Xero', async () => {
    mocks.getCustomer.mockResolvedValue({ id: 12, status: 'reversed', source: 'manual' });
    mocks.getXeroState.mockRejectedValue(new Error('Xero unavailable'));

    await executeCreditNoteReversalWorkflow({
      kind: 'customer_credit_note', businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context,
    });

    expect(mocks.getXeroState).not.toHaveBeenCalled();
    expect(mocks.reverseCustomer).toHaveBeenCalledOnce();
    expect(mocks.voidCustomer).toHaveBeenCalledOnce();
  });
});
