import { describe, expect, it } from 'vitest';

import { allocateCentsProportionally, allocateOnlineShopValue } from '../onlineShopValueAllocation';

describe('allocateOnlineShopValue', () => {
  it('applies a fixed reward before store credit', () => {
    expect(allocateOnlineShopValue({
      grossTotalCents: 10_000,
      rewardValueCents: 2_000,
      storeCreditBalanceCents: 5_000,
      storeCreditReservedElsewhereCents: 1_000,
      requestedStoreCreditCents: 3_000,
    })).toEqual({
      loyaltyCents: 2_000,
      storeCreditCents: 3_000,
      payableCents: 5_000,
      availableStoreCreditCents: 4_000,
    });
  });

  it('does not allocate credit reserved by another checkout', () => {
    expect(allocateOnlineShopValue({
      grossTotalCents: 5_000,
      rewardValueCents: 0,
      storeCreditBalanceCents: 4_000,
      storeCreditReservedElsewhereCents: 2_500,
      requestedStoreCreditCents: 4_000,
    }).storeCreditCents).toBe(1_500);
  });

  it('caps store credit at the amount remaining after the reward', () => {
    expect(allocateOnlineShopValue({
      grossTotalCents: 5_000,
      rewardValueCents: 4_000,
      storeCreditBalanceCents: 10_000,
      storeCreditReservedElsewhereCents: 0,
      requestedStoreCreditCents: 10_000,
    }).payableCents).toBe(0);
  });

  it('refuses to partially consume a fixed reward', () => {
    expect(() => allocateOnlineShopValue({
      grossTotalCents: 1_000,
      rewardValueCents: 1_500,
      storeCreditBalanceCents: 0,
      storeCreditReservedElsewhereCents: 0,
      requestedStoreCreditCents: 0,
    })).toThrow('reward value exceeds');
  });

  it('allocates cents deterministically across fulfilment groups', () => {
    expect(allocateCentsProportionally(1_001, [2_000, 3_000])).toEqual([400, 601]);
    expect(allocateCentsProportionally(5_000, [2_000, 3_000])).toEqual([2_000, 3_000]);
  });
});