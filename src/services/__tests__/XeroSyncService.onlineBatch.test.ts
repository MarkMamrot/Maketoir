import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute, mockXeroApiFetch } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn(), imsExecute: vi.fn() }));
vi.mock('@/services/XeroService', () => ({
  getValidAccessToken: vi.fn(),
  xeroApiFetch: mockXeroApiFetch,
}));

import { syncDailySalesBatch } from '../XeroSyncService';

describe('syncDailySalesBatch online payout state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return [{ Field: 'xero_state' }];
      return [];
    });
  });

  it('persists the combined invoice before applying immediate gateway payments', async () => {
    mockXeroApiFetch
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-1', InvoiceNumber: 'INV-100', Status: 'AUTHORISED' }],
      })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] })
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', Status: 'PAID' }] });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 150,
      totalTax: 15,
      lineDescription: 'Online Sales 2026-07-25',
      payoutManaged: true,
      gatewayAllocations: [
        { gateway: 'shopify_payments', amount: 110, payoutManaged: true },
        { gateway: 'paypal', amount: 55, payoutManaged: false },
      ],
      clearingPayments: [{
        accountCode: '092',
        amount: 55,
        label: 'paypal',
        paymentKey: 'paypal-order-1002',
        reference: 'PayPal #1002',
      }],
    });

    expect(result).toBe('invoice-1');
    const batchInsert = mockExecute.mock.calls.find(call => String(call[0]).includes('(business_id, batch_date, xero_invoice_id'));
    expect(batchInsert?.[1]).toEqual([
      'biz-1', '2026-07-25', 'invoice-1', 'INV-100', 165, 'AUTHORISED',
      JSON.stringify([
        { gateway: 'shopify_payments', amount: 110, payoutManaged: true },
        { gateway: 'paypal', amount: 55, payoutManaged: false },
      ]),
      1,
    ]);
    expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(mockXeroApiFetch.mock.invocationCallOrder[1]);
    expect(mockXeroApiFetch.mock.calls[1][1]).toBe('/Payments');
    expect(mockXeroApiFetch.mock.calls[2][1]).toBe('/Invoices/invoice-1');
    expect(mockXeroApiFetch.mock.calls[1][2].body.Payments[0]).toMatchObject({
      Account: { Code: '092' },
      Amount: 55,
      Reference: 'PayPal #1002',
    });
    expect(mockXeroApiFetch.mock.calls[0][2].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(mockXeroApiFetch.mock.calls[1][2].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(mockExecute.mock.calls.some(call => String(call[0]).includes('INSERT IGNORE INTO xero_online_order_payments'))).toBe(true);
    expect(mockExecute.mock.calls.some(call => String(call[0]).includes("SET status = 'completed'"))).toBe(true);
    const finalLog = mockExecute.mock.calls.find(call => String(call[0]).includes('INSERT INTO xero_sync_log'));
    expect(finalLog?.[1]?.[5]).toBe('PAID');
  });

  it('does not repost an order payment already owned or completed by another run', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-existing' }];
      return [];
    });
    mockExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('xero_online_order_payments')) return { affectedRows: 0 };
      return { affectedRows: 1 };
    });
    mockXeroApiFetch.mockResolvedValueOnce({
      Invoices: [{ InvoiceID: 'invoice-existing', Status: 'AUTHORISED', Total: 55, AmountPaid: 0, AmountCredited: 0 }],
    });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 50,
      totalTax: 5,
      lineDescription: 'Online Sales 2026-07-25',
      clearingPayments: [{
        accountCode: '092',
        amount: 55,
        paymentKey: 'paypal-order-1002',
        reference: 'PayPal #1002',
      }],
    });

    expect(result).toBe('invoice-existing');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(1);
    expect(mockXeroApiFetch.mock.calls[0][1]).toBe('/Invoices/invoice-existing');
  });

  it('posts a separate durable fee spend after the gross order payment', async () => {
    mockXeroApiFetch
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', Status: 'AUTHORISED' }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] })
      .mockResolvedValueOnce({ BankTransactions: [{ BankTransactionID: 'fee-1' }] });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 90.91,
      totalTax: 9.09,
      lineDescription: 'Online Sales 2026-07-25',
      clearingPayments: [{
        accountCode: '093',
        amount: 100,
        label: 'afterpay',
        paymentKey: 'gateway-order-3001',
        reference: 'afterpay #3001',
        fee: { amount: 1.3, gatewayName: 'afterpay', accountCode: '404', taxType: 'INPUT' },
      }],
    });

    expect(result).toBe('invoice-1');
    expect(mockXeroApiFetch.mock.calls[1][1]).toBe('/Payments');
    expect(mockXeroApiFetch.mock.calls[2][1]).toBe('/BankTransactions');
    expect(mockXeroApiFetch.mock.calls[2][2].body.BankTransactions[0]).toMatchObject({
      Type: 'SPEND',
      BankAccount: { Code: '093' },
      LineAmountTypes: 'Inclusive',
      LineItems: [{ UnitAmount: 1.3, AccountCode: '404', TaxType: 'INPUT' }],
    });
    expect(mockExecute.mock.calls.some(call => String(call[0]).includes('INSERT IGNORE INTO xero_online_order_fees'))).toBe(true);
  });

  it('retries a failed fee without reposting its completed gross payment', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-existing' }];
      if (sql.includes('FROM xero_online_order_payments')) return [{ status: 'completed' }];
      return [];
    });
    mockExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('xero_online_order_payments')) return { affectedRows: 0 };
      return { affectedRows: 1 };
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-existing', Status: 'AUTHORISED', Total: 100, AmountPaid: 100, AmountCredited: 0 }],
      })
      .mockResolvedValueOnce({ BankTransactions: [{ BankTransactionID: 'fee-2' }] });

    await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 90.91,
      totalTax: 9.09,
      lineDescription: 'Online Sales 2026-07-25',
      clearingPayments: [{
        accountCode: '093', amount: 100, paymentKey: 'gateway-order-3001',
        fee: { amount: 1.3, gatewayName: 'afterpay', accountCode: '404', taxType: 'NONE' },
      }],
    });

    expect(mockXeroApiFetch).toHaveBeenCalledTimes(2);
    expect(mockXeroApiFetch.mock.calls[1][1]).toBe('/BankTransactions');
  });

  it('refreshes an unpaid existing canonical invoice when late orders increase the completed-day total', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-existing' }];
      return [];
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({
        Invoices: [{
          InvoiceID: 'invoice-existing', Status: 'AUTHORISED', Total: 144.85,
          AmountDue: 144.85, AmountPaid: 0, AmountCredited: 0,
        }],
      })
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-existing', Status: 'AUTHORISED', Total: 337.04 }],
      });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 306.4,
      totalTax: 30.64,
      lineDescription: 'Online Sales 2026-07-25',
    });

    expect(result).toBe('invoice-existing');
    expect(mockXeroApiFetch).toHaveBeenNthCalledWith(1, 'biz-1', '/Invoices/invoice-existing');
    expect(mockXeroApiFetch).toHaveBeenNthCalledWith(2, 'biz-1', '/Invoices/invoice-existing', expect.objectContaining({
      method: 'POST',
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      body: { Invoices: [expect.objectContaining({ InvoiceID: 'invoice-existing' })] },
    }));
  });

  it('replaces a voided canonical invoice without reusing its Xero ID', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-voided' }];
      return [];
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-voided', Status: 'VOIDED', Total: 144.85, AmountPaid: 0, AmountCredited: 0 }],
      })
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-replacement', InvoiceNumber: 'INV-200', Status: 'AUTHORISED', Total: 337.04 }],
      });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-27',
      channel: 'online',
      totalSales: 306.4,
      totalTax: 30.64,
      lineDescription: 'Online Sales 2026-07-27 (5 orders)',
      payoutManaged: true,
      gatewayAllocations: [{ gateway: 'shopify_payments', amount: 337.04, payoutManaged: true }],
    });

    expect(result).toBe('invoice-replacement');
    expect(mockXeroApiFetch).toHaveBeenNthCalledWith(2, 'biz-1', '/Invoices', expect.objectContaining({
      method: 'POST',
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const persisted = mockExecute.mock.calls.filter(call => String(call[0]).includes('(business_id, batch_date, xero_invoice_id')).at(-1);
    expect(persisted?.[1]?.[2]).toBe('invoice-replacement');
  });

  it('reuses the existing invoice while retrying an idempotent clearing payment', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-existing' }];
      return [];
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({
        Invoices: [{ InvoiceID: 'invoice-existing', Status: 'AUTHORISED', Total: 110, AmountPaid: 0, AmountCredited: 0 }],
      })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] })
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-existing', Status: 'PAID' }] });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 100,
      totalTax: 10,
      lineDescription: 'Online Sales 2026-07-25',
      clearingPayments: [{ accountCode: '092', amount: 110, label: 'paypal' }],
    });

    expect(result).toBe('invoice-existing');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(3);
    expect(mockXeroApiFetch).toHaveBeenCalledWith('biz-1', '/Payments', expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('does not post while another request owns a fresh claim', async () => {
    mockExecute
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ affectedRows: 0 });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 150,
      totalTax: 15,
      lineDescription: 'Online Sales 2026-07-25',
    });

    expect(result).toBeNull();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
  });

  it('backfills a historical successful batch instead of reposting it', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [];
      if (sql.includes("sync_type = 'online_batch'")) return [{ xero_id: 'invoice-historical' }];
      return [];
    });
    mockXeroApiFetch.mockResolvedValueOnce({
      Invoices: [{ InvoiceID: 'invoice-historical', Status: 'AUTHORISED', Total: 110, AmountPaid: 0, AmountCredited: 0 }],
    });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-24',
      channel: 'online',
      totalSales: 100,
      totalTax: 10,
      lineDescription: 'Online Sales 2026-07-24',
    });

    expect(result).toBe('invoice-historical');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(1);
    expect(mockXeroApiFetch.mock.calls[0][1]).toBe('/Invoices/invoice-historical');
    expect(mockExecute.mock.calls.some(call => String(call[0]).includes('AUTHORISED'))).toBe(true);
  });
});