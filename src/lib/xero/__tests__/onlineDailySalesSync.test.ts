import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunImsForBusiness,
  mockImsQuery,
  mockQuery,
  mockSyncDailySalesBatch,
  mockSyncGiftCardLiabilityReclass,
  mockGetBusinessTimeZone,
  mockGetXeroDocumentPolicy,
} = vi.hoisted(() => ({
  mockRunImsForBusiness: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
  mockSyncDailySalesBatch: vi.fn(),
  mockSyncGiftCardLiabilityReclass: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
  mockGetXeroDocumentPolicy: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/services/XeroSyncService', () => ({
  syncDailySalesBatch: mockSyncDailySalesBatch,
  syncGiftCardLiabilityReclass: mockSyncGiftCardLiabilityReclass,
}));

vi.mock('@/lib/ims/businessTimeZone', () => ({
  getBusinessTimeZone: mockGetBusinessTimeZone,
}));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({
  getXeroDocumentPolicy: mockGetXeroDocumentPolicy,
}));

import { DEFAULT_XERO_DOCUMENT_POLICY } from '@/lib/xero/documentPolicies';

import { calculateGatewayFee, syncOnlineDailySalesDay } from '../onlineDailySalesSync';
import { getOnlineBatchOrderIdentity } from '../onlineDailySalesSync';

describe('calculateGatewayFee', () => {
  it('rounds a fixed plus percentage fee to cents', () => {
    expect(calculateGatewayFee(100, 0.3, 1)).toBe(1.3);
    expect(calculateGatewayFee(55, 0.3, 1.75)).toBe(1.26);
  });
});

describe('getOnlineBatchOrderIdentity', () => {
  it('keeps Shopify keys stable and gives native checkouts a separate idempotency namespace', () => {
    expect(getOnlineBatchOrderIdentity({ sales_channel: 'shopify', native_checkout_id: null, shopify_order_id: '1001', shopify_order_name: '#1001' }))
      .toEqual({ id: '1001', reference: '#1001' });
    expect(getOnlineBatchOrderIdentity({ sales_channel: 'native_shop', native_checkout_id: 'checkout-1', shopify_order_id: null, shopify_order_name: null }))
      .toEqual({ id: 'native-checkout-1', reference: 'Native order checkout-1' });
  });
});
describe('syncOnlineDailySalesDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T02:00:00Z'));
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockGetXeroDocumentPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mockQuery.mockResolvedValue([
      { gateway_name: 'shopify_payments', clearing_account_code: '091' },
      { gateway_name: 'paypal', clearing_account_code: '092' },
    ]);
    mockImsQuery
      .mockResolvedValueOnce([{ total_sales: '165', total_tax: '15', gift_card_amount: '20', order_count: '2' }])
      .mockResolvedValueOnce([
        { gateway: 'shopify payments', total_sales: '110', total_tax: '10' },
        { gateway: 'paypal express', total_sales: '55', total_tax: '5' },
      ])
      .mockResolvedValueOnce([
        { shopify_order_id: '1001', shopify_order_name: '#1001', payment_gateway: 'Shopify Payments', total_amount: '110', tax_amount: '10' },
        { shopify_order_id: '1002', shopify_order_name: '#1002', payment_gateway: 'PayPal Express', total_amount: '55', tax_amount: '5' },
      ]);
    mockSyncDailySalesBatch.mockResolvedValue('invoice-1');
    mockSyncGiftCardLiabilityReclass.mockResolvedValue('journal-1');
  });

  afterEach(() => {
    vi.useRealTimers();
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
      clearingPayments: [{
        accountCode: '092',
        amount: 55,
        label: 'paypal_express',
        paymentKey: 'paypal-order-1002',
        reference: 'PayPal #1002',
      }],
      gatewayAllocations: [
        { gateway: 'shopify_payments', amount: 110, payoutManaged: true },
        { gateway: 'paypal_express', amount: 55, payoutManaged: false },
      ],
      invoiceStatus: 'AUTHORISED',
    }));
    expect(mockSyncGiftCardLiabilityReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', amount: 20, date: '2026-07-25', channel: 'online',
    }));
    expect(result).toMatchObject({ xeroId: 'invoice-1', totalSales: 165, totalTax: 15 });
  });

  it('rejects syncing the current business day before it closes', async () => {
    await expect(syncOnlineDailySalesDay('biz-1', '2026-07-27')).rejects.toThrow(
      'Online daily sales can only be synced for completed business days.',
    );

    expect(mockSyncDailySalesBatch).not.toHaveBeenCalled();
    expect(mockSyncGiftCardLiabilityReclass).not.toHaveBeenCalled();
  });

  it('creates a separate gross payment for each PayPal order', async () => {
    mockImsQuery.mockReset();
    mockImsQuery
      .mockResolvedValueOnce([{ total_sales: '198', total_tax: '18', gift_card_amount: '0', order_count: '2' }])
      .mockResolvedValueOnce([{ gateway: 'paypal express', total_sales: '198', total_tax: '18' }])
      .mockResolvedValueOnce([
        { shopify_order_id: '2001', shopify_order_name: '#2001', payment_gateway: 'PayPal Express', total_amount: '55', tax_amount: '5' },
        { shopify_order_id: '2002', shopify_order_name: '#2002', payment_gateway: 'PayPal Express', total_amount: '143', tax_amount: '13' },
      ]);

    await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      clearingPayments: [
        expect.objectContaining({ amount: 55, paymentKey: 'paypal-order-2001', reference: 'PayPal #2001' }),
        expect.objectContaining({ amount: 143, paymentKey: 'paypal-order-2002', reference: 'PayPal #2002' }),
      ],
    }));
  });

  it('creates gross per-order payments with separate calculated fees when enabled', async () => {
    mockQuery.mockResolvedValueOnce([{
      gateway_name: 'afterpay',
      clearing_account_code: '093',
      fee_account_code: '404',
      fee_tax_type: 'INPUT',
      deduct_fee_enabled: 1,
      fixed_fee_amount: '0.30',
      percentage_fee_rate: '1.00',
    }]);
    mockImsQuery.mockReset();
    mockImsQuery
      .mockResolvedValueOnce([{ total_sales: '100', total_tax: '9.09', gift_card_amount: '0', order_count: '1' }])
      .mockResolvedValueOnce([{ gateway: 'afterpay', total_sales: '100', total_tax: '9.09' }])
      .mockResolvedValueOnce([{
        shopify_order_id: '3001', shopify_order_name: '#3001', payment_gateway: 'Afterpay', total_amount: '100', tax_amount: '9.09',
      }]);

    await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      clearingPayments: [expect.objectContaining({
        amount: 100,
        paymentKey: 'gateway-order-3001',
        fee: { amount: 1.3, gatewayName: 'afterpay', accountCode: '404', taxType: 'INPUT' },
      })],
    }));
  });

  it('includes native Stripe orders in the regular online batch without Shopify payout handling', async () => {
    mockQuery.mockResolvedValueOnce([{ gateway_name: 'stripe', clearing_account_code: '094' }]);
    mockImsQuery.mockReset();
    mockImsQuery
      .mockResolvedValueOnce([{ total_sales: '88', total_tax: '8', gift_card_amount: '0', order_count: '1' }])
      .mockResolvedValueOnce([{ gateway: 'stripe', total_sales: '88', total_tax: '8' }])
      .mockResolvedValueOnce([{
        sales_channel: 'native_shop',
        native_checkout_id: 'checkout-1',
        shopify_order_id: null,
        shopify_order_name: null,
        payment_gateway: 'Stripe',
        total_amount: '88',
        tax_amount: '8',
      }]);

    await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(mockSyncDailySalesBatch).toHaveBeenCalledTimes(1);
    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      channel: 'online',
      totalSales: 80,
      totalTax: 8,
      payoutManaged: false,
      clearingPayments: [{ accountCode: '094', amount: 88, label: 'stripe' }],
      gatewayAllocations: [{ gateway: 'stripe', amount: 88, payoutManaged: false }],
    }));
    for (const [sql] of mockImsQuery.mock.calls) {
      expect(sql).toContain("so_type = 'online'");
      expect(sql).toContain('COALESCE(is_staff_preview_test, 0) = 0');
    }
  });

  it('creates a Draft online invoice without immediate clearing payments', async () => {
    mockGetXeroDocumentPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      onlineBatchAction: 'draft',
      onlineBatchPaymentSyncEnabled: false,
    });

    await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      invoiceStatus: 'DRAFT',
    }));
    expect(mockSyncDailySalesBatch.mock.calls[0][1]).not.toHaveProperty('clearingPayments');
  });

  it('keeps a no-sync online day local', async () => {
    mockGetXeroDocumentPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      onlineBatchAction: 'none',
      onlineBatchPaymentSyncEnabled: false,
    });

    const result = await syncOnlineDailySalesDay('biz-1', '2026-07-25');

    expect(result.xeroId).toBeNull();
    expect(mockSyncDailySalesBatch).not.toHaveBeenCalled();
  });
});