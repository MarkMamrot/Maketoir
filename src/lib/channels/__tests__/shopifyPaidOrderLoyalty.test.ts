import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ markUsed: vi.fn(), award: vi.fn() }));

vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: {
    markPaidOrderRedemptionsUsed: mocks.markUsed,
    awardPaidOrder: mocks.award,
  },
}));

import { applyShopifyPaidOrderLoyalty } from '@/lib/channels/shopifyPaidOrderLoyalty';

describe('applyShopifyPaidOrderLoyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markUsed.mockResolvedValue({ used: 1 });
    mocks.award.mockResolvedValue({ status: 'awarded' });
  });

  it('routes voucher consumption and earning through the exact instance', async () => {
    await applyShopifyPaidOrderLoyalty({
      businessId: 'business-1',
      channelInstanceId: 'instance-2',
      order: {
        id: 1001,
        customer: { id: 7001 },
        processed_at: '2026-09-25T01:00:00Z',
        subtotal_price: '100.00',
        discount_codes: [{ code: 'reward-10' }],
        line_items: [
          { quantity: 1, price: '80.00', gift_card: false, discount_allocations: [] },
          { quantity: 1, price: '20.00', gift_card: true, discount_allocations: [] },
        ],
      },
    });

    expect(mocks.markUsed).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-2', shopifyOrderId: '1001',
      shopifyCustomerId: '7001', discountCodes: ['reward-10'],
    });
    expect(mocks.award).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-2', shopifyOrderId: '1001',
      paidDate: '2026-09-25', eligibleSpend: 80,
    });
  });

  it('skips voucher consumption without an exact external customer but still evaluates earning', async () => {
    await applyShopifyPaidOrderLoyalty({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      order: { id: 1001, created_at: '2026-09-25T01:00:00Z', subtotal_price: '10.00', line_items: [] },
    });

    expect(mocks.markUsed).not.toHaveBeenCalled();
    expect(mocks.award).toHaveBeenCalledOnce();
  });
});