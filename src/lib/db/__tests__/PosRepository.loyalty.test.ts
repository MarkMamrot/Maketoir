import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockApplyTransaction, mockReserveReward, mockReversePosSale, mockReversePosReturn, mockReconcilePosSaleEarn, mockUnwindGiftCards, mockSyncConfiguredCustomer } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockApplyTransaction: vi.fn(),
  mockReserveReward: vi.fn(),
  mockReversePosSale: vi.fn(),
  mockReversePosReturn: vi.fn(),
  mockReconcilePosSaleEarn: vi.fn(),
  mockUnwindGiftCards: vi.fn(),
  mockSyncConfiguredCustomer: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
}));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyEditBlockedError: class LoyaltyEditBlockedError extends Error {},
  LoyaltyValidationError: class LoyaltyValidationError extends Error {},
  LoyaltyVoidBlockedError: class LoyaltyVoidBlockedError extends Error {},
  LoyaltyRepository: {
    applyTransaction: mockApplyTransaction,
    reserveReward: mockReserveReward,
    reversePosSale: mockReversePosSale,
    reversePosReturn: mockReversePosReturn,
    reconcilePosSaleEarn: mockReconcilePosSaleEarn,
  },
}));
vi.mock('@/lib/ims/posReturnCreditNote', () => ({ getPosStockQtyChange: vi.fn() }));
vi.mock('@/lib/pos/giftCardSaleVoid', () => ({ unwindGiftCardTransactionsForSale: mockUnwindGiftCards }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mockSyncConfiguredCustomer },
}));

import { PosSalesRepo } from '@/lib/db/PosRepository';

function saleData() {
  return {
    business_id: 'business-1',
    local_id: 'local-1',
    register_id: 1,
    register_session_id: 2,
    location_id: 3,
    cashier_id: 4,
    cashier_name: 'Staff',
    sale_type: 'sale' as const,
    status: 'completed' as const,
    customer_id: 42,
    subtotal: 100,
    discount_total: 0,
    tax_total: 9.09,
    total: 100,
    items: [{
      variant_id: null,
      code: 'SKU-1',
      name: 'Product',
      qty: 1,
      unit_price: 100,
      discount_type: 'none' as const,
      discount_value: 0,
      discount_amount: 0,
      tax_rate: 10,
      line_total: 100,
    }],
    payments: [],
  };
}

function setupConnections(settings: Array<{ key: string; value: string }>, contacts: unknown[] = [{ id: 42 }]) {
  const saleConnection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn()
      .mockResolvedValueOnce([{ insertId: 101 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([settings])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([contacts]),
  };
  const stockConnection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(),
  };
  const getConnection = vi.fn()
    .mockResolvedValueOnce(saleConnection)
    .mockResolvedValueOnce(stockConnection);
  mockGetIMSPool.mockReturnValue({ getConnection });
  return { saleConnection, stockConnection };
}

describe('PosSalesRepo loyalty earning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApplyTransaction.mockResolvedValue({ transactionId: 8, accountId: 9, balanceAfter: 100, duplicate: false });
    mockReserveReward.mockResolvedValue({
      transactionId: 10,
      accountId: 9,
      balanceAfter: 80,
      duplicate: false,
      redemptionId: 11,
      rewardId: 5,
      pointsDeducted: 20,
      rewardValueAud: 5,
      status: 'used',
    });
    mockReversePosSale.mockResolvedValue({ earnReversals: [], redemptionReversals: [] });
    mockReversePosReturn.mockResolvedValue({ transactionId: 12, accountId: 9, balanceAfter: 50, duplicate: false });
    mockReconcilePosSaleEarn.mockResolvedValue({ transactionId: 13, accountId: 9, balanceAfter: 90, duplicate: false });
    mockUnwindGiftCards.mockResolvedValue([]);
    mockSyncConfiguredCustomer.mockResolvedValue({ status: 'synced' });
  });

  it('awards enrolled customer points before committing the sale', async () => {
    const { saleConnection } = setupConnections([
      { key: 'loyalty_enabled', value: '1' },
      { key: 'loyalty_earn_rate', value: '1' },
      { key: 'loyalty_started_at', value: '2020-01-01' },
    ]);

    const result = await PosSalesRepo.complete(saleData());

    expect(mockApplyTransaction).toHaveBeenCalledWith(saleConnection, expect.objectContaining({
      businessId: 'business-1',
      contactId: 42,
      pointsDelta: 100,
      idempotencyKey: 'pos:sale:101:earn',
    }));
    expect(mockApplyTransaction.mock.invocationCallOrder[0]).toBeLessThan(saleConnection.commit.mock.invocationCallOrder[0]);
    expect(saleConnection.commit.mock.invocationCallOrder[0]).toBeLessThan(mockSyncConfiguredCustomer.mock.invocationCallOrder[0]);
    expect(mockSyncConfiguredCustomer).toHaveBeenCalledWith({ businessId: 'business-1', contactId: 42 });
    expect(result).toMatchObject({ saleId: 101, loyaltyPoints: 100, loyalty: { transactionId: 8 } });
  });

  it('skips earning when the business program is disabled', async () => {
    setupConnections([{ key: 'loyalty_enabled', value: '0' }]);

    const result = await PosSalesRepo.complete(saleData());

    expect(mockApplyTransaction).not.toHaveBeenCalled();
    expect(result.loyaltyPoints).toBe(0);
  });

  it('skips earning when the customer has not opted in', async () => {
    setupConnections([
      { key: 'loyalty_enabled', value: '1' },
      { key: 'loyalty_earn_rate', value: '1' },
    ], []);

    const result = await PosSalesRepo.complete(saleData());

    expect(mockApplyTransaction).not.toHaveBeenCalled();
    expect(result.loyaltyPoints).toBe(0);
  });

  it('redeems a reward against the sale and earns only on net eligible spend', async () => {
    const { saleConnection } = setupConnections([
      { key: 'loyalty_enabled', value: '1' },
      { key: 'loyalty_earn_rate', value: '1' },
      { key: 'loyalty_started_at', value: '2020-01-01' },
    ]);
    const data = {
      ...saleData(),
      loyalty_reward_id: 5,
      loyalty_discount_total: 5,
      discount_total: 5,
      tax_total: 95 * 0.1 / 1.1,
      total: 95,
    };

    const result = await PosSalesRepo.complete(data);

    expect(mockReserveReward).toHaveBeenCalledWith(saleConnection, expect.objectContaining({
      rewardId: 5,
      posSaleId: 101,
      idempotencyKey: 'pos:sale:101:reward:5',
    }));
    expect(mockReserveReward.mock.invocationCallOrder[0]).toBeLessThan(saleConnection.commit.mock.invocationCallOrder[0]);
    expect(mockApplyTransaction).toHaveBeenCalledWith(saleConnection, expect.objectContaining({ pointsDelta: 95 }));
    expect(result).toMatchObject({ loyaltyPoints: 95, loyaltyRedemption: { redemptionId: 11, status: 'used' } });
  });

  it('rejects reward redemption when the business program is disabled', async () => {
    const { saleConnection } = setupConnections([{ key: 'loyalty_enabled', value: '0' }]);
    const data = {
      ...saleData(),
      loyalty_reward_id: 5,
      loyalty_discount_total: 5,
      discount_total: 5,
      tax_total: 95 * 0.1 / 1.1,
      total: 95,
    };

    await expect(PosSalesRepo.complete(data)).rejects.toThrow('loyalty program is not active');

    expect(mockReserveReward).not.toHaveBeenCalled();
    expect(saleConnection.rollback).toHaveBeenCalledTimes(1);
    expect(saleConnection.commit).not.toHaveBeenCalled();
  });

  it('rolls back the sale if the atomic loyalty write fails', async () => {
    const { saleConnection } = setupConnections([
      { key: 'loyalty_enabled', value: '1' },
      { key: 'loyalty_earn_rate', value: '1' },
    ]);
    mockApplyTransaction.mockRejectedValueOnce(new Error('ledger unavailable'));

    await expect(PosSalesRepo.complete(saleData())).rejects.toThrow('ledger unavailable');

    expect(saleConnection.rollback).toHaveBeenCalledTimes(1);
    expect(saleConnection.commit).not.toHaveBeenCalled();
  });

  it('validates and reverses a linked partial return before committing it', async () => {
    const saleConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ id: 101, customer_id: 42, discount_total: 5, total: 90 }]])
        .mockResolvedValueOnce([[{
          id: 501,
          variant_id: null,
          qty: 2,
          line_total: 95,
          discount_amount: 0,
          is_gift_card: 0,
        }]])
        .mockResolvedValueOnce([[{ return_of_sale_item_id: 501, qty: -0.5 }]])
        .mockResolvedValueOnce([{ insertId: 202 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };
    const stockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn(),
    };
    mockGetIMSPool.mockReturnValue({
      getConnection: vi.fn().mockResolvedValueOnce(saleConnection).mockResolvedValueOnce(stockConnection),
    });

    await PosSalesRepo.complete({
      ...saleData(),
      local_id: 'return-1',
      sale_type: 'return',
      return_of_sale_id: 101,
      subtotal: -22.5,
      discount_total: 0,
      tax_total: -2.05,
      total: -22.5,
      items: [{
        ...saleData().items[0],
        return_of_sale_item_id: 501,
        qty: -0.5,
        line_total: -22.5,
      }],
    });

    expect(mockReversePosReturn).toHaveBeenCalledWith(saleConnection, expect.objectContaining({
      businessId: 'business-1',
      originalSaleId: 101,
      returnSaleId: 202,
      originalEligibleCents: 9000,
      cumulativeReturnedCents: 4500,
    }));
    expect(mockReversePosReturn.mock.invocationCallOrder[0]).toBeLessThan(saleConnection.commit.mock.invocationCallOrder[0]);
    expect(saleConnection.execute.mock.calls[4][0]).toContain('return_of_sale_item_id');
  });

  it('reconciles manager-edited earning inside the sale update transaction', async () => {
    vi.spyOn(PosSalesRepo, 'get').mockResolvedValueOnce({
      sale: {
        id: 101,
        business_id: 'business-1',
        status: 'completed',
        sale_type: 'sale',
        location_id: 3,
        customer_id: 42,
      },
      items: [{ variant_id: null, qty: 1 }],
      payments: [],
    } as any);
    const saleConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{
          business_id: 'business-1',
          customer_id: 42,
          status: 'completed',
          sale_type: 'sale',
          loyalty_earn_rate: 1,
        }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValue([{ affectedRows: 1 }]),
    };
    const stockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn(),
    };
    mockGetIMSPool.mockReturnValue({
      getConnection: vi.fn().mockResolvedValueOnce(saleConnection).mockResolvedValueOnce(stockConnection),
    });

    await PosSalesRepo.updateFull(101, {
      sale_type: 'sale',
      subtotal: 90,
      discount_total: 0,
      tax_total: 90 / 11,
      total: 90,
      actor_id: 4,
      items: [{
        variant_id: null,
        code: 'SKU-1',
        name: 'Product',
        qty: 1,
        unit_price: 90,
        discount_type: 'none',
        discount_value: 0,
        discount_amount: 0,
        tax_rate: 10,
        line_total: 90,
      }],
      payments: [{ payment_method: 'Card', amount: 90 }],
    });

    expect(mockReconcilePosSaleEarn).toHaveBeenCalledWith(saleConnection, {
      businessId: 'business-1',
      saleId: 101,
      targetPoints: 90,
      actorId: 4,
    });
    expect(mockReconcilePosSaleEarn.mock.invocationCallOrder[0]).toBeLessThan(saleConnection.commit.mock.invocationCallOrder[0]);
    expect(saleConnection.commit.mock.invocationCallOrder[0]).toBeLessThan(mockSyncConfiguredCustomer.mock.invocationCallOrder[0]);
  });

  it('reverses loyalty inside the manager void transaction before commit', async () => {
    const stockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ status: 'completed' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(stockConnection) });
    vi.spyOn(PosSalesRepo, 'get').mockResolvedValueOnce({
      sale: {
        id: 101,
        business_id: 'business-1',
        status: 'completed',
        sale_type: 'sale',
        location_id: 3,
        customer_id: 42,
      },
      items: [],
      payments: [],
    } as any);

    await PosSalesRepo.voidWithReversal(101, 'manager-1');

    expect(mockReversePosSale).toHaveBeenCalledWith(stockConnection, {
      businessId: 'business-1',
      saleId: 101,
      actorId: 'manager-1',
    });
    expect(mockReversePosSale.mock.invocationCallOrder[0]).toBeLessThan(stockConnection.commit.mock.invocationCallOrder[0]);
    expect(stockConnection.commit.mock.invocationCallOrder[0]).toBeLessThan(mockSyncConfiguredCustomer.mock.invocationCallOrder[0]);
    expect(stockConnection.execute.mock.calls[1][0]).toContain("status = 'voided'");
  });
});