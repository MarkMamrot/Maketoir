import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute, mockImsQuery, mockImsExecute, mockXeroApiFetch } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/services/XeroService', () => ({
  getValidAccessToken: vi.fn(),
  xeroApiFetch: mockXeroApiFetch,
}));

import { triggerEodXeroSync } from '../XeroSyncService';

function persistence() {
  return {
    setXeroInvoice: vi.fn().mockResolvedValue(undefined),
    setXeroPayment: vi.fn().mockResolvedValue(undefined),
    setXeroPaymentError: vi.fn().mockResolvedValue(undefined),
  };
}

describe('triggerEodXeroSync clearing payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('xero_pos_clearing_mappings')) return Promise.resolve([]);
      if (sql.includes('xero_account_mappings')) return Promise.resolve([{ role_key: 'sales_revenue', xero_account_code: '200' }]);
      if (sql.includes('xero_tracking_mappings')) return Promise.resolve([{
        ims_location_id: 4,
        ims_channel: null,
        xero_tracking_category_id: 'category-1',
        xero_tracking_option_id: 'option-4',
      }]);
      return Promise.resolve([]);
    });
    mockImsQuery.mockImplementation((sql: string) => {
      if (sql.includes('net_rounding')) return Promise.resolve([{ net_rounding: '0' }]);
      if (sql.includes('issued_total')) return Promise.resolve([{ issued_total: '0' }]);
      return Promise.resolve([]);
    });
  });

  it('blocks only the method with no location clearing mapping before creating an invoice', async () => {
    const store = persistence();
    const results = await triggerEodXeroSync(
      'biz-1', 4, '2026-07-25',
      [{ payment_method: 'Card', counted_amount: 110, opening_float: 0 }],
      'Newtown', 2, store,
    );

    expect(results).toEqual([expect.objectContaining({ method: 'Card', status: 'blocked_missing_mapping' })]);
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    expect(store.setXeroInvoice).not.toHaveBeenCalled();
  });

  it('posts Sales Revenue with location tracking, persists the invoice, then pays the clearing account', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('xero_pos_clearing_mappings')) return Promise.resolve([{ payment_method: 'Card', xero_account_code: '091' }]);
      if (sql.includes('xero_account_mappings')) return Promise.resolve([{ role_key: 'sales_revenue', xero_account_code: '200' }]);
      if (sql.includes('xero_tracking_mappings')) return Promise.resolve([{
        ims_location_id: 4, ims_channel: null,
        xero_tracking_category_id: 'category-1', xero_tracking_option_id: 'option-4',
      }]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', InvoiceNumber: 'INV-1', AmountDue: 110, Status: 'AUTHORISED' }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] });
    const store = persistence();

    const results = await triggerEodXeroSync(
      'biz-1', 4, '2026-07-25',
      [{ payment_method: 'Card', counted_amount: 110, opening_float: 0, register_session_id: 8 }],
      'Newtown', 2, store, 'Front Till',
    );

    const invoiceCall = mockXeroApiFetch.mock.calls[0];
    expect(invoiceCall[1]).toBe('/Invoices');
    expect(invoiceCall[2].body.Invoices[0].LineItems[0]).toEqual(expect.objectContaining({
      UnitAmount: 110,
      AccountCode: '200',
      TaxType: 'OUTPUT',
      Tracking: [{ TrackingCategoryID: 'category-1', TrackingOptionID: 'option-4' }],
    }));
    expect(store.setXeroInvoice).toHaveBeenCalledWith(4, '2026-07-25', 'Card', 'invoice-1', '091', 2);
    expect(mockXeroApiFetch.mock.calls[1][2].body.Payments[0]).toEqual(expect.objectContaining({
      Invoice: { InvoiceID: 'invoice-1' },
      Account: { Code: '091' },
      Amount: 110,
    }));
    expect(store.setXeroPayment).toHaveBeenCalledWith(4, '2026-07-25', 'Card', 'payment-1', '091', 2);
    expect(results).toEqual([expect.objectContaining({ status: 'paid', xeroId: 'invoice-1' })]);
  });

  it('retries only the payment when a new-flow invoice already exists', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('xero_pos_clearing_mappings')) return Promise.resolve([{ payment_method: 'Card', xero_account_code: '091' }]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', AmountDue: 110 }] })
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-2' }] });
    const store = persistence();

    const results = await triggerEodXeroSync(
      'biz-1', 4, '2026-07-25',
      [{ payment_method: 'Card', counted_amount: 110, opening_float: 0, xero_invoice_id: 'invoice-1', xero_payment_required: 1 }],
      'Newtown', 2, store,
    );

    expect(mockXeroApiFetch.mock.calls.map(call => call[1])).toEqual(['/Invoices/invoice-1', '/Payments']);
    expect(store.setXeroInvoice).not.toHaveBeenCalled();
    expect(store.setXeroPayment).toHaveBeenCalledWith(4, '2026-07-25', 'Card', 'payment-2', '091', 2);
    expect(results[0].status).toBe('paid');
  });

  it('keeps the invoice and records a retryable error when payment creation fails', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('xero_pos_clearing_mappings')) return Promise.resolve([{ payment_method: 'Cash', xero_account_code: '090' }]);
      if (sql.includes('xero_account_mappings')) return Promise.resolve([{ role_key: 'sales_revenue', xero_account_code: '200' }]);
      if (sql.includes('xero_tracking_mappings')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-cash', AmountDue: 100 }] })
      .mockRejectedValueOnce(new Error('bank account rejected'));
    const store = persistence();

    const results = await triggerEodXeroSync(
      'biz-1', 4, '2026-07-25',
      [{ payment_method: 'Cash', counted_amount: 150, opening_float: 50 }],
      'Newtown', 2, store,
    );

    expect(store.setXeroInvoice).toHaveBeenCalledBefore(store.setXeroPaymentError);
    expect(store.setXeroPaymentError).toHaveBeenCalledWith(4, '2026-07-25', 'Cash', 'bank account rejected', '090', 2);
    expect(results).toEqual([expect.objectContaining({ status: 'invoice_posted_payment_failed', xeroId: 'invoice-cash' })]);
  });
});