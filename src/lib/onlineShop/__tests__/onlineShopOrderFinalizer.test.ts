import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runForBusiness: vi.fn(),
  getPool: vi.fn(),
  getCustomer: vi.fn(),
  recompute: vi.fn(),
  applyLoyalty: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getPool }));
vi.mock('@/lib/onlineShop/onlineShopIdentity', () => ({ getOrCreateOnlineShopCustomer: mocks.getCustomer }));
vi.mock('@/lib/ims/builds/buildRequirementService', () => ({ recomputeBuildRequirementsSafely: mocks.recompute }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyRepository: { applyTransaction: mocks.applyLoyalty, reserveReward: vi.fn() },
}));

import { OnlineShopOrderFinalizer } from '@/lib/onlineShop/onlineShopOrderFinalizer';

describe('OnlineShopOrderFinalizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mocks.getCustomer.mockResolvedValue({ contactId: 10 });
  });

  it('uses collation-safe joins when loading paid checkout items', async () => {
    const identityConnection = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ guest_email: 'customer@example.com' }]])
        .mockResolvedValueOnce([[]]),
      release: vi.fn(),
    };
    let itemSql = '';
    const checkoutConnection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('FROM ims_online_shop_checkouts')) {
          return [[{
            checkout_id: 'checkout-1', status: 'open', fulfilment_mode: 'single_location',
            fulfilment_type: 'delivery', location_id: 1, total_cents: 100,
            currency_code: 'AUD', completed_so_id: null,
          }]];
        }
        if (sql.includes('FROM ims_online_shop_fulfilment_groups')) return [[]];
        if (sql.includes('FROM ims_online_shop_payment_attempts')) return [[{ id: 1, amount_cents: 100 }]];
        if (sql.includes('FROM ims_online_shop_checkout_items item')) {
          itemSql = sql;
          throw new Error('stop after checkout item query');
        }
        return [[]];
      }),
    };
    mocks.getPool.mockReturnValue({
      getConnection: vi.fn()
        .mockResolvedValueOnce(identityConnection)
        .mockResolvedValueOnce(checkoutConnection),
    });

    await expect(OnlineShopOrderFinalizer.finalizePaid({
      businessId: 'business-1', checkoutId: 'checkout-1', providerPaymentId: 'payment-1', amountCents: 100,
    })).rejects.toThrow('stop after checkout item query');

    expect(itemSql).toContain('BINARY variant.business_id = BINARY item.business_id');
    expect(itemSql).toContain('BINARY variant.variant_id = BINARY item.variant_id');
    expect(itemSql).toContain('BINARY product.business_id = BINARY variant.business_id');
    expect(itemSql).toContain('BINARY product.product_id = BINARY variant.product_id');
    expect(checkoutConnection.rollback).toHaveBeenCalledOnce();
  });
});