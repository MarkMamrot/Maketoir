import { describe, expect, it } from 'vitest';

import { allocateOnlineShopCart, OnlineShopStockConflict } from '../fulfilmentAllocation';

const lines = [
  { variantId: 'red-small', quantity: 2, unitPriceCents: 1100 },
  { variantId: 'blue-large', quantity: 1, unitPriceCents: 550 },
];

describe('allocateOnlineShopCart', () => {
  it('uses the first priority location that can fulfil the entire cart', () => {
    const result = allocateOnlineShopCart({ mode: 'single_location', lines, locations: [
      { locationId: 2, priority: 1, availableByVariant: { 'red-small': 1, 'blue-large': 5 } },
      { locationId: 3, priority: 2, availableByVariant: { 'red-small': 2, 'blue-large': 1 } },
    ] });
    expect(result.dispatchLocationId).toBe(3);
    expect(result.reservations).toEqual([
      { variantId: 'red-small', locationId: 3, quantity: 2 },
      { variantId: 'blue-large', locationId: 3, quantity: 1 },
    ]);
    expect(result).toMatchObject({ subtotalCents: 2750, taxCents: 250 });
  });

  it('rejects single-location checkout when stock only exists across locations', () => {
    expect(() => allocateOnlineShopCart({ mode: 'single_location', lines, locations: [
      { locationId: 2, priority: 1, availableByVariant: { 'red-small': 2 } },
      { locationId: 3, priority: 2, availableByVariant: { 'blue-large': 1 } },
    ] })).toThrow(OnlineShopStockConflict);
  });

  it('reserves source stock and assigns one dispatch location in consolidate mode', () => {
    const result = allocateOnlineShopCart({ mode: 'consolidate', lines, dispatchLocationId: 3, locations: [
      { locationId: 2, priority: 1, availableByVariant: { 'red-small': 2 } },
      { locationId: 3, priority: 2, availableByVariant: { 'blue-large': 1 } },
    ] });
    expect(result.dispatchLocationId).toBe(3);
    expect(result.fulfilmentGroups).toHaveLength(1);
    expect(result.reservations.map(item => item.locationId)).toEqual([2, 3]);
  });

  it('creates one fulfilment group per source location in split mode', () => {
    const result = allocateOnlineShopCart({ mode: 'split', lines, locations: [
      { locationId: 2, priority: 1, availableByVariant: { 'red-small': 1, 'blue-large': 1 } },
      { locationId: 3, priority: 2, availableByVariant: { 'red-small': 1 } },
    ] });
    expect(result.fulfilmentGroups.map(group => group.locationId)).toEqual([2, 3]);
    expect(result.reservations.filter(item => item.variantId === 'red-small')).toHaveLength(2);
  });

  it('never allocates more than available across locations', () => {
    expect(() => allocateOnlineShopCart({ mode: 'split', lines, locations: [
      { locationId: 2, priority: 1, availableByVariant: { 'red-small': 1, 'blue-large': 1 } },
    ] })).toThrow('Insufficient stock for variant red-small.');
  });

  it('does not check or reserve inventory for untracked lines', () => {
    const result = allocateOnlineShopCart({
      mode: 'single_location',
      lines: [{ variantId: 'service', quantity: 50, unitPriceCents: 1100, tracksInventory: false }],
      locations: [{ locationId: 2, priority: 1, availableByVariant: {} }],
    });
    expect(result.dispatchLocationId).toBe(2);
    expect(result.reservations).toEqual([]);
    expect(result.fulfilmentGroups).toEqual([{ locationId: 2, reservations: [] }]);
  });

  it('checks only tracked inventory in mixed carts', () => {
    const result = allocateOnlineShopCart({
      mode: 'split',
      lines: [
        { variantId: 'tracked', quantity: 1, unitPriceCents: 1100 },
        { variantId: 'service', quantity: 100, unitPriceCents: 500, tracksInventory: false },
      ],
      locations: [{ locationId: 2, priority: 1, availableByVariant: { tracked: 1 } }],
    });
    expect(result.reservations).toEqual([{ variantId: 'tracked', locationId: 2, quantity: 1 }]);
  });
});