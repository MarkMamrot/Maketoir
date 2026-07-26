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
      .mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] });

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
      clearingPayments: [{ accountCode: '092', amount: 55, label: 'paypal' }],
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
    expect(mockXeroApiFetch.mock.calls[1][2].body.Payments[0]).toMatchObject({
      Account: { Code: '092' },
      Amount: 55,
    });
    expect(mockXeroApiFetch.mock.calls[0][2].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(mockXeroApiFetch.mock.calls[1][2].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the existing canonical invoice without posting again', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return [{ role_key: 'sales_revenue', xero_account_code: '200' }];
      }
      if (sql.includes('FROM xero_tracking_mappings')) return [];
      if (sql.includes('FROM xero_online_batches')) return [{ xero_invoice_id: 'invoice-existing' }];
      return [];
    });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 150,
      totalTax: 15,
      lineDescription: 'Online Sales 2026-07-25',
    });

    expect(result).toBe('invoice-existing');
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
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
    mockXeroApiFetch.mockResolvedValueOnce({ Payments: [{ PaymentID: 'payment-1' }] });

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-25',
      channel: 'online',
      totalSales: 100,
      totalTax: 10,
      lineDescription: 'Online Sales 2026-07-25',
      clearingPayments: [{ accountCode: '092', amount: 110, label: 'paypal' }],
    });

    expect(result).toBe('invoice-existing');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(1);
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

    const result = await syncDailySalesBatch('biz-1', {
      date: '2026-07-24',
      channel: 'online',
      totalSales: 100,
      totalTax: 10,
      lineDescription: 'Online Sales 2026-07-24',
    });

    expect(result).toBe('invoice-historical');
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    expect(mockExecute.mock.calls.some(call => String(call[0]).includes('AUTHORISED'))).toBe(true);
  });
});