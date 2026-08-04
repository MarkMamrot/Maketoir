import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockGetMutation, mockApplyTransaction, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockGetMutation: vi.fn(),
  mockApplyTransaction: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mockGetIMSPool }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyValidationError: class LoyaltyValidationError extends Error {},
  LoyaltyRepository: { getMutationByIdempotencyKey: mockGetMutation, applyTransaction: mockApplyTransaction },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

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
    mockReportRuntimeIssue.mockResolvedValue(undefined);
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
});