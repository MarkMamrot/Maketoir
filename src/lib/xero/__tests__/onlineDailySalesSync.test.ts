import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunImsForBusiness,
  mockImsQuery,
  mockQuery,
  mockSyncDailySalesBatch,
  mockSyncGiftCardLiabilityReclass,
} = vi.hoisted(() => ({
  mockRunImsForBusiness: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
  mockSyncDailySalesBatch: vi.fn(),
  mockSyncGiftCardLiabilityReclass: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/services/XeroSyncService', () => ({
  syncDailySalesBatch: mockSyncDailySalesBatch,
  syncGiftCardLiabilityReclass: mockSyncGiftCardLiabilityReclass,
}));

import { syncOnlineDailySalesDay } from '../onlineDailySalesSync';

describe('syncOnlineDailySalesDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockQuery.mockResolvedValue([
      { gateway_name: 'shopify_payments', clearing_account_code: '091' },
      { gateway_name: 'paypal', clearing_account_code: '092' },
    ]);
    mockImsQuery
      .mockResolvedValueOnce([{ total_sales: '150', total_tax: '15', gift_card_amount: '20', order_count: '2' }])
      .mockResolvedValueOnce([
        { gateway: 'shopify payments', total_sales: '100', total_tax: '10' },
        { gateway: 'paypal express', total_sales: '50', total_tax: '5' },
      ]);
    mockSyncDailySalesBatch.mockResolvedValue('invoice-1');
    mockSyncGiftCardLiabilityReclass.mockResolvedValue('journal-1');
  });

  it('builds one canonical invoice with clearing and payout allocations', async () => {
    const result = await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      date: '2026-07-25',
      channel: 'online',
      totalSales: 150,
      totalTax: 15,
      payoutManaged: true,
      clearingPayments: [{ accountCode: '092', amount: 55, label: 'paypal_express' }],
      gatewayAllocations: [
        { gateway: 'shopify_payments', amount: 110, payoutManaged: true },
        { gateway: 'paypal_express', amount: 55, payoutManaged: false },
      ],
    }));
    expect(mockSyncGiftCardLiabilityReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', amount: 20, date: '2026-07-25', channel: 'online',
    }));
    expect(result.xeroId).toBe('invoice-1');
  });
});