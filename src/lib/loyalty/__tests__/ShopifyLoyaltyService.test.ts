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

  it('passes exact instance identity when consuming a Shopify voucher', async () => {
    mockMarkShopifyVoucherUsed.mockResolvedValueOnce(true);

    await ShopifyLoyaltyService.markPaidOrderRedemptionsUsed({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyCustomerId: '12345', discountCodes: ['reward'],
    });

    expect(mockMarkShopifyVoucherUsed).toHaveBeenCalledWith(
      'business-1', 'REWARD', '12345', 'instance-2',
    );
  });

  it('awards an exact order under instance-namespaced identities', async () => {
    const connection = setupConnection([
      [[{ id: 10, customer_id: 42, financial_status: 'paid' }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }]],
      [[{ id: 42 }]],
    ]);

    await ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', paidDate: '2026-09-25', eligibleSpend: 40,
    });

    expect(connection.execute.mock.calls[0][0]).toContain('channel_instance_id = ?');
    expect(connection.execute.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mockApplyTransaction).toHaveBeenCalledWith(connection, expect.objectContaining({
      sourceId: 'instance-2:1001',
      idempotencyKey: 'shopify:instance-2:order:1001:earn',
    }));
    expect(mockSyncConfiguredCustomer).toHaveBeenCalledWith({
      businessId: 'business-1', contactId: 42, channelInstanceId: 'instance-2',
    });
  });

  it('returns an existing award before recalculating with current settings', async () => {
    mockGetMutation.mockResolvedValueOnce({ transactionId: 1, accountId: 2, balanceAfter: 90, duplicate: true });

    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    })).resolves.toMatchObject({ status: 'awarded', points: null, mutation: { duplicate: true } });
    expect(mockGetIMSPool).not.toHaveBeenCalled();
    expect(mockSyncConfiguredCustomer).not.toHaveBeenCalled();
  });

  it('can defer a newly committed award projection to independent recovery', async () => {
    const connection = setupConnection([
      [[{ id: 10, customer_id: 42, financial_status: 'paid' }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }]],
      [[{ id: 42 }]],
    ]);
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', shopifyOrderId: '1001',
      paidDate: '2026-08-04', eligibleSpend: 90, deferMetafieldSync: true,
    })).resolves.toMatchObject({ status: 'awarded' });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(mockSyncConfiguredCustomer).not.toHaveBeenCalled();
  });

  it.each(['partially_refunded', 'refunded'])('allows historical %s earning only for explicit recovery', async financial_status => {
    const blocked = setupConnection([[[{ id: 10, customer_id: 42, financial_status }]]]);
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    })).resolves.toEqual({ status: 'skipped', reason: 'not_paid' });
    expect(blocked.commit).toHaveBeenCalledTimes(1);
    const recovery = setupConnection([
      [[{ id: 10, customer_id: 42, financial_status }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }]],
      [[{ id: 42 }]],
    ]);
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', shopifyOrderId: '1001',
      paidDate: '2026-08-04', eligibleSpend: 90, allowRefundedOrder: true, deferMetafieldSync: true,
    })).resolves.toMatchObject({ status: 'awarded' });
    expect(mockApplyTransaction).toHaveBeenCalledWith(recovery, expect.objectContaining({
      pointsDelta: 90, eligibleSpendCents: 9000,
      idempotencyKey: 'shopify:instance-2:order:1001:earn',
    }));
  });

  it('does not roll back a committed/released paid award when legacy projection throws', async () => {
    const connection = setupConnection([
      [[{ id: 10, customer_id: 42, financial_status: 'paid' }]],
      [[{ key: 'loyalty_enabled', value: '1' }, { key: 'loyalty_earn_rate', value: '1' }]],
      [[{ id: 42 }]],
    ]);
    mockSyncConfiguredCustomer.mockRejectedValueOnce(new Error('projection failed'));
    await expect(ShopifyLoyaltyService.awardPaidOrder({
      businessId: 'business-1', shopifyOrderId: '1001', paidDate: '2026-08-04', eligibleSpend: 90,
    })).rejects.toThrow('projection failed');
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
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

    expect(connection.execute.mock.calls[0]?.[0]).toContain('BINARY t.business_id = BINARY so.business_id');
    expect(connection.execute.mock.calls[0]?.[0]).toContain('BINARY t.source_id = BINARY so.shopify_order_id');
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

  it('scopes refund reversal and metafield sync to the exact Shopify instance', async () => {
    const connection = setupConnection([
      [[{ id: 1, account_id: 2, contact_id: 42, points_delta: 95, eligible_spend_cents: 9500 }]],
      [[]],
    ]);

    await ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyRefundId: 'refund-2', eligibleRefundSpend: 20,
    });

    expect(connection.execute.mock.calls[0][0]).toContain('so.channel_instance_id = ?');
    expect(connection.execute.mock.calls[0][1]).toEqual([
      'instance-2:1001', 'business-1', 'instance-2', '1001',
    ]);
    expect(mockApplyTransaction).toHaveBeenCalledWith(connection, expect.objectContaining({
      sourceId: 'instance-2:1001',
      idempotencyKey: 'shopify:instance-2:refund:refund-2:earn',
    }));
    expect(mockSyncConfiguredCustomer).toHaveBeenCalledWith({
      businessId: 'business-1', contactId: 42, channelInstanceId: 'instance-2',
    });
  });

  it('allows recovery to checkpoint the local reversal separately from the provider projection', async () => {
    const connection = setupConnection([
      [[{ id: 1, account_id: 2, contact_id: 42, points_delta: 95, eligible_spend_cents: 9500 }]],
      [[]],
    ]);

    await expect(ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyRefundId: '7001', eligibleRefundSpend: 20,
      deferMetafieldSync: true,
    })).resolves.toMatchObject({ status: 'reversed', points: 20 });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(mockSyncConfiguredCustomer).not.toHaveBeenCalled();
  });

  it('replays a completed reversal without writing points or acquiring a connection', async () => {
    mockGetMutation.mockResolvedValueOnce({ transactionId: 9, accountId: 2, balanceAfter: 0, duplicate: true });
    await expect(ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyRefundId: '7001', eligibleRefundSpend: 20,
      deferMetafieldSync: true,
    })).resolves.toMatchObject({ status: 'reversed', mutation: { duplicate: true } });
    expect(mockApplyTransaction).not.toHaveBeenCalled();
    expect(mockGetIMSPool).not.toHaveBeenCalled();
    expect(mockSyncConfiguredCustomer).not.toHaveBeenCalled();
  });

  it('does not roll back a released connection if the legacy post-commit projection throws', async () => {
    const connection = setupConnection([
      [[{ id: 1, account_id: 2, contact_id: 42, points_delta: 95, eligible_spend_cents: 9500 }]],
      [[]],
    ]);
    mockSyncConfiguredCustomer.mockRejectedValueOnce(new Error('Projection failed'));
    await expect(ShopifyLoyaltyService.reverseRefund({
      businessId: 'business-1', shopifyOrderId: '1001', shopifyRefundId: '7001', eligibleRefundSpend: 20,
    })).rejects.toThrow('Projection failed');
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'reverse_refund' }));
  });
});