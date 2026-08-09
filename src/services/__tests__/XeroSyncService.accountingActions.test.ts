import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(),
  xeroFetch: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), runtimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/services/XeroService', () => ({ getValidAccessToken: vi.fn(), xeroApiFetch: mocks.xeroFetch }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.runtimeIssue }));
vi.mock('@/lib/xero/accountingActionRepository', () => ({
  claimXeroAccountingAction: mocks.claim,
  completeXeroAccountingAction: mocks.complete,
  failXeroAccountingAction: mocks.fail,
}));

import { syncPOPayment, syncPOReceivedJournal, syncSOPayment } from '../XeroSyncService';

describe('Xero payment and receipt-journal actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('xero_account_mappings')) return Promise.resolve([
        { role_key: 'inventory_asset', xero_account_code: '630' },
        { role_key: 'inventory_in_transit', xero_account_code: '631' },
      ]);
      return Promise.resolve([]);
    });
    mocks.claim.mockResolvedValue({ claimed: true, action: { id: 17, status: 'running', xeroId: null } });
    mocks.complete.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.runtimeIssue.mockResolvedValue(undefined);
  });

  it('preflights AmountDue and posts a replay-safe PO payment', async () => {
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCPAY', Status: 'AUTHORISED', CurrencyCode: 'AUD', AmountDue: 75 }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] });

    const result = await syncPOPayment('biz-1', 'bill-1', 42, 9, 75, '2026-08-09', 'AUD', '090');

    expect(result).toBe('payment-1');
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: 'po-payment:42:9', sourceId: 9, requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(mocks.xeroFetch.mock.calls.map(call => call[1])).toEqual(['/Invoices/bill-1', '/Payments']);
    expect(mocks.xeroFetch.mock.calls[1][2]).toEqual(expect.objectContaining({ idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(mocks.complete).toHaveBeenCalledWith(17, 'payment-1');
  });

  it('rejects an SO payment above the live amount due before POST', async () => {
    mocks.xeroFetch.mockResolvedValueOnce({
      Invoices: [{ Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'AUD', AmountDue: 20 }],
    });

    await expect(syncSOPayment('biz-1', 'invoice-1', 12, 5, 25, '2026-08-09', 'AUD', '090')).resolves.toBeNull();

    expect(mocks.xeroFetch).toHaveBeenCalledTimes(1);
    expect(mocks.fail).toHaveBeenCalledWith(17, 'failed', expect.stringContaining('below payment'));
  });

  it('holds an ambiguous payment outcome for reconciliation', async () => {
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCPAY', Status: 'AUTHORISED', CurrencyCode: 'AUD', AmountDue: 75 }] })
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 75, '2026-08-09', 'AUD', '090')).resolves.toBeNull();

    expect(mocks.fail).toHaveBeenCalledWith(17, 'unknown', 'fetch failed');
  });

  it('posts a signed and idempotent Inventory in Transit transfer journal', async () => {
    mocks.xeroFetch.mockResolvedValueOnce({ ManualJournals: [{ ManualJournalID: 'journal-1' }] });

    const result = await syncPOReceivedJournal('biz-1', 42, 'PO-42', 'bill-1', 110, 4);

    expect(result).toBe('journal-1');
    const options = mocks.xeroFetch.mock.calls[0][2];
    expect(options.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(options.body.ManualJournals[0].JournalLines).toEqual([
      expect.objectContaining({ AccountCode: '630', LineAmount: 110 }),
      expect.objectContaining({ AccountCode: '631', LineAmount: -110 }),
    ]);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: 'po-received-journal:42:bill-1', actionType: 'po_received_journal',
    }));
  });
});