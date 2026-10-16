import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(),
  xeroFetch: vi.fn(), token: vi.fn(), claim: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/services/XeroService', () => ({ getValidAccessToken: mocks.token, xeroApiFetch: mocks.xeroFetch }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/xero/accountingActionRepository', () => ({
  claimXeroAccountingAction: mocks.claim, completeXeroAccountingAction: vi.fn(), failXeroAccountingAction: vi.fn(),
}));
import {
  allocateXeroCreditNote, approveBill, approveCreditNote, deleteXeroCreditNoteAllocation, refundXeroCreditNote,
  syncCogsJournal, syncPOAsDraftBill, syncPOAttachmentsToXero, syncPOPayment, syncPOReceivedJournal,
  syncSupplierCNAsCreditNote, syncSupplierCNAttachmentsToXero, updateXeroDraftBill,
  updateXeroDraftSupplierCreditNote, voidXeroBill, voidXeroSupplierCreditNote,
} from '../XeroSyncService';

describe('consignment accounting entrypoint safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imsQuery.mockResolvedValue([{ consignment_supplier_id: 7 }]);
  });
  const po = { id: 42 } as Parameters<typeof syncPOAsDraftBill>[1];
  const scn = { id: 43 } as Parameters<typeof syncSupplierCNAsCreditNote>[1];
  it.each([
    () => syncPOAsDraftBill('business-1', po),
    () => syncSupplierCNAsCreditNote('business-1', scn),
    () => syncPOPayment('business-1', 'bill-1', 42, 2, 20, '2026-09-01', 'AUD', '090'),
    () => syncPOAttachmentsToXero('business-1', 42, 'PO-42', 'bill-1'),
  ])('blocks a missing persisted source before any Xero operation', async action => {
    mocks.imsQuery.mockResolvedValue([]);
    await expect(action()).rejects.toThrow('ownership could not be verified');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it.each([
    ['new bill', () => syncPOAsDraftBill('business-1', po)],
    ['update bill', () => updateXeroDraftBill('business-1', po, 'bill-1')],
    ['approve bill', () => approveBill('business-1', 'bill-1', 42)],
    ['PO payment', () => syncPOPayment('business-1', 'bill-1', 42, 2, 20, '2026-09-01', 'AUD', '090')],
    ['PO receipt journal', () => syncPOReceivedJournal('business-1', 42, 'PO-42', 'bill-1', 20, 1)],
    ['void bill', () => voidXeroBill('business-1', 'bill-1', 42)],
    ['PO attachments', () => syncPOAttachmentsToXero('business-1', 42, 'PO-42', 'bill-1')],
    ['supplier credit', () => syncSupplierCNAsCreditNote('business-1', scn)],
    ['update supplier credit', () => updateXeroDraftSupplierCreditNote('business-1', scn, 'credit-1')],
    ['approve supplier credit', () => approveCreditNote('business-1', 'credit-1', 43, 'scn_credit_note')],
    ['void supplier credit', () => voidXeroSupplierCreditNote('business-1', 'credit-1', 43)],
    ['supplier attachments', () => syncSupplierCNAttachmentsToXero('business-1', 43, 'SCN-43', 'credit-1')],
  ] as const)('excludes %s even when the caller omits the snapshot', async (_name, action) => {
    await action();
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('consignment_supplier_id');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it.each([
    () => refundXeroCreditNote({ businessId: 'business-1', creditNoteId: 'credit-1', amount: 10, accountCode: '090', date: '2026-09-01', reference: 'SCN', actionKey: 'a' }),
    () => allocateXeroCreditNote({ businessId: 'business-1', creditNoteId: 'credit-1', invoiceId: 'bill-1', amount: 10, actionKey: 'b' }),
    () => deleteXeroCreditNoteAllocation('business-1', 'credit-1', 'allocation-1'),
  ])('blocks supplier-credit money movements and their reversal', async action => {
    await expect(action()).rejects.toThrow('intentionally excluded');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
  });
});

describe('signed consignment COGS buckets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('xero_account_mappings') ? [
      { role_key: 'cogs', xero_account_code: '300' }, { role_key: 'inventory_asset', xero_account_code: '630' },
    ] : []));
    mocks.execute.mockResolvedValue({ insertId: 1 });
    mocks.claim.mockResolvedValue({ claimed: true, action: { id: 1 } });
    mocks.xeroFetch.mockResolvedValue({ ManualJournals: [{ ManualJournalID: 'owned-journal', Status: 'POSTED' }] });
  });
  const bucket = (amount: number, supplier: number | null) => ({
    locationId: 1, locationName: 'Shop', channel: 'pos', amount, consignment_supplier_id: supplier,
    ownership: supplier == null ? 'owned' as const : 'consignment' as const, ownershipEvidence: 'movement_snapshot' as const,
  });

  it.each([
    { locationId: 1, locationName: 'Shop', channel: 'pos', amount: 20 },
    { locationId: 1, locationName: 'Shop', channel: 'pos', amount: 20, ownership: 'unknown', ownershipEvidence: 'movement_snapshot' },
    { locationId: 1, locationName: 'Shop', channel: 'pos', amount: 20, ownership: 'owned' },
  ])('rejects unknown/anonymous ownership buckets before Xero calls', async anonymous => {
    await expect(syncCogsJournal({
      businessId: 'business-1', label: 'Period', journalDate: '2026-09-30', amount: 20,
      buckets: [anonymous as Parameters<typeof syncCogsJournal>[0]['buckets'][number]],
    })).rejects.toThrow('explicit immutable ownership');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each([50, -50])('never posts a consignment-only %s bucket', async amount => {
    await expect(syncCogsJournal({ businessId: 'business-1', label: 'Period', journalDate: '2026-09-30', amount, buckets: [bucket(amount, 7)] }))
      .rejects.toThrow('intentionally excluded');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
  });

  it.each([50, -50])('posts only the owned portion of mixed signed %s buckets', async excluded => {
    await syncCogsJournal({
      businessId: 'business-1', label: 'Period', journalDate: '2026-09-30',
      amount: 20 + excluded, buckets: [bucket(20, null), bucket(excluded, 7)],
    });
    const journal = mocks.xeroFetch.mock.calls[0][2].body.ManualJournals[0];
    expect(journal.JournalLines).toHaveLength(2);
    expect(journal.JournalLines.map((line: { LineAmount: number }) => line.LineAmount)).toEqual([20, -20]);
  });
});
