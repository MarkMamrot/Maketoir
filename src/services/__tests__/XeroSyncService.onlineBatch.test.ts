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
    const batchInsert = mockExecute.mock.calls.find(call => String(call[0]).includes('INSERT INTO xero_online_batches'));
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
  });
});