import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockGetMutation, mockApplyTransaction, mockMarkShopifyVoucherUsed, mockReportRuntimeIssue, mockSyncConfiguredCustomer } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockGetMutation: vi.fn(),
  mockApplyTransaction: vi.fn(),
  mockMarkShopifyVoucherUsed: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockSyncConfiguredCustomer: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mockGetIMSPool }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyValidationError: class LoyaltyValidationError extends Error {},
  LoyaltyRepository: {
    getMutationByIdempotencyKey: mockGetMutation,
    applyTransaction: mockApplyTransaction,
    markShopifyVoucherUsed: mockMarkShopifyVoucherUsed,
  },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mockSyncConfiguredCustomer },
}));

import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';

function setupConnection(results: unknown[]) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(),
  };
  for (const result of results) connection.execute.mockResolvedValueOnce(result as never);
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
  return connection;
}

describe('ShopifyLoyaltyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMutation.mockResolvedValue(null);
    mockApplyTransaction.mockResolvedValue({ transactionId: 1, accountId: 2, balanceAfter: 90, duplicate: false });
    mockMarkShopifyVoucherUsed.mockResolvedValue(false);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
    mockSyncConfiguredCustomer.mockResolvedValue({ status: 'synced' });
  });

  it('marks unique loyalty codes used for the exact Shopify customer', async () => {
    mockMarkShopifyVoucherUsed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(ShopifyLoyaltyService.markPaidOrderRedemptionsUsed({
      businessId: 'business-1',
      shopifyOrderId: '1001',
      shopifyCustomerId: '12345',
      discountCodes: ['solv-55-abc', 'SOLV-55-ABC', 'other-code'],
    })).resolves.toEqual({ used: 1 });

    expect(mockMarkShopifyVoucherUsed.mock.calls).toEqual([
      ['business-1', 'SOLV-55-ABC', '12345'],
      ['business-1', 'OTHER-CODE', '12345'],
    ]);
  });

  it('returns an existing award before recalculating with current settings', async () => {
    mockGetMutation.mockResolvedValueOnce({ transactionId: 1, accountId: 2, balanceAfter: 90, duplicate: true });

    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    })).resolves.toMatchObject({ status: 'awarded', points: null, mutation: { duplicate: true } });
    expect(mockGetIMSPool).not.toHaveBeenCalled();
  });

  it('awards an enrolled customer from a persisted paid order before commit', async () => {
    const connection = setupConnection([
      [[{ id: 10, customer_id: 42, financial_status: 'paid' }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }, { key: 'loyalty_started_at', value: '2026-08-01' }]],
      [[{ id: 42 }]],
    ]);

    const result = await ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    });

    expect(mockApplyTransaction).toHaveBeenCalledWith(connection, expect.objectContaining({
      contactId: 42,
      pointsDelta: 90,
      channel: 'shopify',
      sourceType: 'shopify_order',
      idempotencyKey: 'shopify:order:1001:earn',
    }));
    expect(mockApplyTransaction.mock.invocationCallOrder[0]).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
    expect(connection.release.mock.invocationCallOrder[0]).toBeLessThan(mockSyncConfiguredCustomer.mock.invocationCallOrder[0]);
    expect(mockSyncConfiguredCustomer).toHaveBeenCalledWith({ businessId: 'business-1', contactId: 42 });
    expect(result).toMatchObject({ status: 'awarded', points: 90 });
  });

  it('skips unpaid orders and unenrolled customers without writing points', async () => {
    const unpaidConnection = setupConnection([[[{ id: 10, customer_id: 42, financial_status: 'pending' }]]]);
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    })).resolves.toEqual({ status: 'skipped', reason: 'not_paid' });
    expect(unpaidConnection.commit).toHaveBeenCalledTimes(1);

    const unenrolledConnection = setupConnection([
      [[{ id: 11, customer_id: 43, financial_status: 'paid' }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }]],
      [[]],
    ]);
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1002', paidDate: '2026-08-04', eligibleSpend: 90,
    })).resolves.toEqual({ status: 'skipped', reason: 'customer_not_enrolled' });
    expect(unenrolledConnection.commit).toHaveBeenCalledTimes(1);
    expect(mockApplyTransaction).not.toHaveBeenCalled();
  });

  it('reverses the cumulative proportional refund delta and permits a negative balance', async () => {
    const connection = setupConnection([
      [[{ id: 1, account_id: 2, contact_id: 42, points_delta: 95, eligible_spend_cents: 9500 }]],
      [[{ id: 3, account_id: 2, points_delta: -30, balance_after: 65, eligible_spend_cents: 3000, idempotency_key: 'prior' }]],
    ]);

    const result = await ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', shopifyOrderId: '1001', shopifyRefundId: 'refund-2', eligibleRefundSpend: 32,
    });

    expect(mockApplyTransaction).toHaveBeenCalledWith(connection, expect.objectContaining({
      contactId: 42,
      pointsDelta: -32,
      eligibleSpendCents: 3200,
      channel: 'shopify',
      sourceType: 'shopify_order_refund',
      sourceId: '1001',
      idempotencyKey: 'shopify:refund:refund-2:earn',
      allowNegativeBalance: true,
    }));
    expect(result).toMatchObject({ status: 'reversed', points: 32 });
    expect(connection.release.mock.invocationCallOrder[0]).toBeLessThan(mockSyncConfiguredCustomer.mock.invocationCallOrder[0]);
    expect(mockSyncConfiguredCustomer).toHaveBeenCalledWith({ businessId: 'business-1', contactId: 42 });
  });

  it('replays a concurrently completed refund after acquiring the earn lock', async () => {
    setupConnection([
      [[{ id: 1, account_id: 2, contact_id: 42, points_delta: 95, eligible_spend_cents: 9500 }]],
      [[{ id: 4, account_id: 2, points_delta: -20, balance_after: 75, eligible_spend_cents: 2000, idempotency_key: 'shopify:refund:refund-1:earn' }]],
    ]);

    await expect(ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', shopifyOrderId: '1001', shopifyRefundId: 'refund-1', eligibleRefundSpend: 20,
    })).resolves.toMatchObject({ status: 'reversed', points: null, mutation: { duplicate: true } });
    expect(mockApplyTransaction).not.toHaveBeenCalled();
  });
});