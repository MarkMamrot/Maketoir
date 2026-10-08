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

import { calculatePOStockReceiptValueAud, syncCogsJournal, syncPOPayment, syncPOReceivedJournal, syncSOPayment } from '../XeroSyncService';

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

  it('posts the reciprocal saved AUD-per-USD rate without converting the invoice amount', async () => {
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCPAY', Status: 'AUTHORISED', CurrencyCode: 'USD', AmountDue: 6086 }] })
      .mockResolvedValueOnce({ Organisations: [{ BaseCurrency: 'AUD' }] })
      .mockResolvedValueOnce({ Accounts: [{ Code: '090', CurrencyCode: 'AUD' }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'foreign-payment' }] });

    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 3000, '2026-09-11', 'USD', '090', 1.4)).resolves.toBe('foreign-payment');

    const payment = mocks.xeroFetch.mock.calls.find(call => call[1] === '/Payments')![2].body.Payments[0];
    expect(payment.Amount).toBe(3000);
    expect(payment.CurrencyRate).toBeCloseTo(1 / 1.4, 10);
    expect(payment.Amount / payment.CurrencyRate).toBeCloseTo(4200, 2);
  });

  it('posts to a code-less AUD bank by AccountID and validates its currency', async () => {
    const accountId = 'f9b899b5-919c-442d-be2e-3a6de42d29fc';
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCPAY', Status: 'AUTHORISED', CurrencyCode: 'USD', AmountDue: 3000 }] })
      .mockResolvedValueOnce({ Organisations: [{ BaseCurrency: 'AUD' }] })
      .mockResolvedValueOnce({ Accounts: [{ AccountID: accountId, CurrencyCode: 'AUD' }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'wise-payment' }] });

    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 3000, '2026-09-11', 'USD', accountId, 1.4021)).resolves.toBe('wise-payment');

    expect(mocks.xeroFetch.mock.calls.find(call => call[1] === '/Payments')![2].body.Payments[0].Account).toEqual({ AccountID: accountId });
  });

  it('uses the saved rate for foreign-currency SO payments too', async () => {
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'USD', AmountDue: 100 }] })
      .mockResolvedValueOnce({ Organisations: [{ BaseCurrency: 'AUD' }] })
      .mockResolvedValueOnce({ Accounts: [{ Code: '090', CurrencyCode: 'AUD' }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'foreign-so-payment' }] });

    await syncSOPayment('biz-1', 'invoice-1', 12, 5, 100, '2026-09-11', 'USD', '090', 1.5);

    expect(mocks.xeroFetch.mock.calls.find(call => call[1] === '/Payments')![2].body.Payments[0].CurrencyRate).toBeCloseTo(1 / 1.5, 10);
  });

  it.each([['USD', 'AUD'], ['AUD', 'USD']])('blocks unsupported organisation/account currency %s/%s', async (baseCurrency, accountCurrency) => {
    mocks.xeroFetch
      .mockResolvedValueOnce({ Invoices: [{ Type: 'ACCPAY', Status: 'AUTHORISED', CurrencyCode: 'USD', AmountDue: 6086 }] })
      .mockResolvedValueOnce({ Organisations: [{ BaseCurrency: baseCurrency }] })
      .mockResolvedValueOnce({ Accounts: [{ Code: '090', CurrencyCode: accountCurrency }] });

    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 3000, '2026-09-11', 'USD', '090', 1.4021)).resolves.toBeNull();

    expect(mocks.xeroFetch.mock.calls.some(call => call[1] === '/Payments')).toBe(false);
    expect(mocks.fail).toHaveBeenCalledWith(17, 'failed', expect.stringContaining('requires'));
  });

  it.each([undefined, 0, -1, NaN, Infinity])('does not post a foreign payment with invalid or missing rate %s', async exchangeRate => {
    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 3000, '2026-09-11', 'USD', '090', exchangeRate)).resolves.toBeNull();

    expect(mocks.xeroFetch).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('does not send a second payment when the accounting action is already completed', async () => {
    mocks.claim.mockResolvedValueOnce({ claimed: false, action: { id: 17, status: 'succeeded', xeroId: 'existing-payment' } });

    await expect(syncPOPayment('biz-1', 'bill-1', 42, 9, 3000, '2026-09-11', 'USD', '090', 1.4)).resolves.toBe('existing-payment');

    expect(mocks.xeroFetch).not.toHaveBeenCalled();
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

  it('posts separate balanced location-channel COGS pairs as an actual Xero journal', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('xero_account_mappings')) return Promise.resolve([
        { role_key: 'cogs', xero_account_code: '500' },
        { role_key: 'inventory_asset', xero_account_code: '630' },
      ]);
      return Promise.resolve([]);
    });
    mocks.xeroFetch.mockResolvedValueOnce({ ManualJournals: [{ ManualJournalID: 'cogs-journal-1', Status: 'POSTED' }] });

    await expect(syncCogsJournal({ businessId: 'biz-1', label: 'September 2026', journalDate: '2026-09-30', amount: 100,
      buckets: [
        { locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 60 },
        { locationId: 2, locationName: 'Newtown', channel: 'pos', amount: 40 },
      ],
    })).resolves.toEqual({ journalId: 'cogs-journal-1', xeroState: 'POSTED' });

    const journal = mocks.xeroFetch.mock.calls[0][2].body.ManualJournals[0];
    expect(journal).toMatchObject({ Narration: 'COGS - September 2026', Date: '2026-09-30', Status: 'POSTED' });
    expect(journal.JournalLines).toEqual([
      expect.objectContaining({ AccountCode: '500', Description: 'COGS - Warehouse - Shopify / Online', LineAmount: 60, TaxType: 'NONE' }),
      expect.objectContaining({ AccountCode: '630', Description: 'COGS - Warehouse - Shopify / Online', LineAmount: -60, TaxType: 'NONE' }),
      expect.objectContaining({ AccountCode: '500', Description: 'COGS - Newtown - POS', LineAmount: 40, TaxType: 'NONE' }),
      expect.objectContaining({ AccountCode: '630', Description: 'COGS - Newtown - POS', LineAmount: -40, TaxType: 'NONE' }),
    ]);
    expect(journal.JournalLines.reduce((sum: number, line: { LineAmount: number }) => sum + line.LineAmount, 0)).toBe(0);
  });

  it('refuses a bucket payload that does not reconcile to the requested journal amount', async () => {
    mocks.query.mockImplementation((sql: string) => sql.includes('xero_account_mappings') ? Promise.resolve([
      { role_key: 'cogs', xero_account_code: '500' }, { role_key: 'inventory_asset', xero_account_code: '630' },
    ]) : Promise.resolve([]));
    await expect(syncCogsJournal({ businessId: 'biz-1', label: 'September 2026', journalDate: '2026-09-30', amount: 100,
      buckets: [{ locationId: 1, locationName: 'Warehouse', channel: 'online', amount: 99 }],
    })).rejects.toThrow('do not reconcile');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
  });

  it('limits a mixed prepaid PO journal to discounted stock value and capitalised freight in AUD', () => {
    expect(calculatePOStockReceiptValueAud({
      id: 42,
      po_number: 'PO-42',
      location_id: 4,
      order_date: '2026-09-11',
      subtotal: 150,
      tax_amount: 15,
      discount: 15,
      freight: 20,
      total_amount: 170,
      tax_treatment: 'inc_tax',
      exchange_rate: 1.4,
      items: [
        { variant_id: 'stock', qty_ordered: 1, unit_cost: 110, discount_pct: 0, tax_rate: 0.1, line_total: 110, is_stock_item: 1 },
        { variant_id: 'expense', qty_ordered: 1, unit_cost: 55, discount_pct: 0, tax_rate: 0.1, line_total: 55, is_stock_item: 0 },
      ],
      payments: [{ amount: 200, amount_local: 300, payment_date: '2026-09-01' }],
    }, true)).toBe(165);
  });
});