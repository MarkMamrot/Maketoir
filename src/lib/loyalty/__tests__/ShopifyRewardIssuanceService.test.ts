import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRedemption,
  mockReserveReward,
  mockPrepareVoucher,
  mockMarkIssued,
  mockCancelReserved,
  mockReportRuntimeIssue,
  mockGetConnection,
} = vi.hoisted(() => ({
  mockGetRedemption: vi.fn(),
  mockReserveReward: vi.fn(),
  mockPrepareVoucher: vi.fn(),
  mockMarkIssued: vi.fn(),
  mockCancelReserved: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockGetConnection: vi.fn(),
}));

vi.mock('@/lib/ims/LoyaltyRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/ims/LoyaltyRepository')>();
  return {
    ...original,
    LoyaltyRepository: {
      getRedemptionByIdempotencyKey: mockGetRedemption,
      reserveReward: mockReserveReward,
      prepareRedemptionVoucher: mockPrepareVoucher,
      markRedemptionIssued: mockMarkIssued,
      cancelReservedRedemption: mockCancelReserved,
    },
  };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: mockGetConnection }),
}));

import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { ShopifyRewardIssuanceService } from '@/lib/loyalty/ShopifyRewardIssuanceService';
import { ShopifyAdminUserError } from '@/services/ShopifyService';

const reservation = {
  redemptionId: 55,
  rewardId: 3,
  pointsDeducted: 100,
  rewardValueAud: 10,
  status: 'reserved' as const,
  transactionId: 99,
  accountId: 7,
  balanceAfter: 40,
  duplicate: false,
};

function transactionConnection(contactRows = [{ shopify_customer_id: '12345' }]) {
  return {
    execute: vi.fn()
      .mockResolvedValueOnce([[{ value: '1' }]])
      .mockResolvedValueOnce([contactRows]),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

function shopifyClient() {
  return {
    findDiscountCode: vi.fn().mockResolvedValue(null),
    createCustomerDiscountCode: vi.fn().mockResolvedValue({ id: 'gid://shopify/DiscountCodeNode/88', code: 'SOLV-55-ABC' }),
  };
}

describe('ShopifyRewardIssuanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedemption.mockResolvedValue(null);
    mockReserveReward.mockResolvedValue(reservation);
    mockPrepareVoucher.mockResolvedValue('SOLV-55-ABC');
    mockMarkIssued.mockResolvedValue(undefined);
    mockCancelReserved.mockResolvedValue({ transactionId: 100, accountId: 7, balanceAfter: 140, duplicate: false });
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('issues a one-customer Shopify reward and marks the reservation issued', async () => {
    const connection = transactionConnection();
    mockGetConnection.mockResolvedValue(connection);
    const shopify = shopifyClient();

    const result = await ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1',
      actorId: 8, shopify, now: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(shopify.createCustomerDiscountCode).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SOLV-55-ABC',
      amountAud: 10,
      shopifyCustomerId: '12345',
      startsAt: '2026-08-05T00:00:00.000Z',
      endsAt: '2026-11-03T00:00:00.000Z',
    }));
    expect(mockMarkIssued).toHaveBeenCalledWith(connection, expect.objectContaining({
      redemptionId: 55,
      shopifyDiscountId: 'gid://shopify/DiscountCodeNode/88',
    }));
    expect(result).toMatchObject({ status: 'issued', voucherCode: 'SOLV-55-ABC' });
  });

  it('returns an already-issued redemption without calling Shopify or the database pool', async () => {
    const existing = {
      ...reservation,
      status: 'issued' as const,
      duplicate: true,
      contactId: 42,
      shopifyDiscountId: 'gid://shopify/DiscountCodeNode/88',
      voucherCode: 'SOLV-55-ABC',
    };
    mockGetRedemption.mockResolvedValue(existing);
    const shopify = shopifyClient();

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify,
    })).resolves.toEqual(existing);
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(shopify.findDiscountCode).not.toHaveBeenCalled();
  });

  it('rejects an enrolled customer without an exact Shopify identity before reserving points', async () => {
    mockGetConnection.mockResolvedValue(transactionConnection([]));

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify: shopifyClient(),
    })).rejects.toThrow('not linked to a Shopify customer');
    expect(mockReserveReward).not.toHaveBeenCalled();
  });

  it('propagates insufficient points without calling Shopify', async () => {
    mockGetConnection.mockResolvedValue(transactionConnection());
    mockReserveReward.mockRejectedValue(new LoyaltyValidationError('The customer does not have enough points.'));
    const shopify = shopifyClient();

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify,
    })).rejects.toThrow('does not have enough points');
    expect(shopify.createCustomerDiscountCode).not.toHaveBeenCalled();
  });

  it('restores points when Shopify definitively rejects code creation', async () => {
    const connection = transactionConnection();
    mockGetConnection.mockResolvedValue(connection);
    const shopify = shopifyClient();
    shopify.createCustomerDiscountCode.mockRejectedValue(new ShopifyAdminUserError([{ message: 'Missing write_discounts scope' }]));

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify,
    })).rejects.toThrow('Missing write_discounts scope');
    expect(mockCancelReserved).toHaveBeenCalledWith(connection, expect.objectContaining({ redemptionId: 55 }));
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'issue_reward_code' }));
  });

  it('recovers a concurrent duplicate-code rejection when Shopify now has the persisted code', async () => {
    const connection = transactionConnection();
    mockGetConnection.mockResolvedValue(connection);
    const shopify = shopifyClient();
    shopify.findDiscountCode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'gid://shopify/DiscountCodeNode/88', code: 'SOLV-55-ABC' });
    shopify.createCustomerDiscountCode.mockRejectedValue(new ShopifyAdminUserError([{ message: 'Code must be unique' }]));

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify,
    })).resolves.toMatchObject({ status: 'issued', shopifyDiscountId: 'gid://shopify/DiscountCodeNode/88' });
    expect(mockCancelReserved).not.toHaveBeenCalled();
    expect(mockMarkIssued).toHaveBeenCalled();
  });

  it('leaves points reserved after an ambiguous transport failure so a retry can reconcile the code', async () => {
    mockGetConnection.mockResolvedValue(transactionConnection());
    const shopify = shopifyClient();
    shopify.createCustomerDiscountCode.mockRejectedValue(new Error('fetch failed'));

    await expect(ShopifyRewardIssuanceService.issue({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', shopify,
    })).rejects.toThrow('fetch failed');
    expect(mockCancelReserved).not.toHaveBeenCalled();
    expect(mockReportRuntimeIssue).toHaveBeenCalled();
  });
});