import { describe, expect, it } from 'vitest';
import { changedOpeningStockVariantIds, planOpeningStockLines, resolveOpeningStockLocations } from '../shopifyOpeningStock';

describe('Shopify opening stock', () => {
  it('maps explicitly selected IDs even when location names differ', () => {
    expect(resolveOpeningStockLocations(
      [{ id: 10, name: ' warehouse ', active: true }, { id: 20, name: 'KOTARA', active: true }],
      [{ id: 1, name: 'Ruth Store', active: 1 }, { id: 2, name: 'Office', active: 1 }],
      [{ shopifyLocationId: 10, solvantisLocationId: 1 }, { shopifyLocationId: 20, solvantisLocationId: 2 }],
    )).toEqual([
      { name: 'Ruth Store', shopifyLocationId: 10, solvantisLocationId: 1 },
      { name: 'Office', shopifyLocationId: 20, solvantisLocationId: 2 },
    ]);
  });

  it('refuses missing or duplicate mapped locations', () => {
    expect(() => resolveOpeningStockLocations(
      [{ id: 10, name: 'Warehouse', active: true }],
      [{ id: 1, name: 'Warehouse' }, { id: 2, name: 'Kotara' }],
      [{ shopifyLocationId: 20, solvantisLocationId: 2 }],
    )).toThrow('missing or inactive');
    expect(() => resolveOpeningStockLocations(
      [{ id: 10, name: 'Warehouse' }, { id: 20, name: 'Other' }],
      [{ id: 1, name: 'Warehouse' }],
      [{ shopifyLocationId: 10, solvantisLocationId: 1 }, { shopifyLocationId: 20, solvantisLocationId: 1 }],
    )).toThrow('only once');
    expect(() => resolveOpeningStockLocations([], [], [])).toThrow('Select');
  });

  it('keeps location quantities separate, skips absent levels, and clamps negatives', () => {
    const lines = planOpeningStockLines(
      [
        { variantId: 'v1', inventoryItemId: '100', sku: 'SKU-1' },
        { variantId: 'v2', inventoryItemId: '200', sku: 'SKU-2' },
      ],
      [
        { inventoryItemId: '100', locationId: '10', available: 8 },
        { inventoryItemId: '100', locationId: '20', available: 3 },
        { inventoryItemId: '200', locationId: '10', available: -2 },
        { inventoryItemId: '999', locationId: '30', available: 50 },
      ],
      [
        { name: 'Warehouse', shopifyLocationId: 10, solvantisLocationId: 1 },
        { name: 'Kotara', shopifyLocationId: 20, solvantisLocationId: 2 },
      ],
    );

    expect(lines).toEqual([
      expect.objectContaining({ variantId: 'v1', locationName: 'Warehouse', quantity: 8, wasNegative: false }),
      expect.objectContaining({ variantId: 'v2', locationName: 'Warehouse', quantity: 0, wasNegative: true }),
      expect.objectContaining({ variantId: 'v1', locationName: 'Kotara', quantity: 3, wasNegative: false }),
    ]);
  });

  it('skips null and invalid levels but imports an explicit zero', () => {
    const variants = [{ variantId: 'v1', inventoryItemId: '100' }];
    const locations = [{ name: 'Store', shopifyLocationId: 10, solvantisLocationId: 1 }];
    expect(planOpeningStockLines(variants, [{ inventoryItemId: '100', locationId: '10', available: null }], locations)).toEqual([]);
    expect(planOpeningStockLines(variants, [{ inventoryItemId: '100', locationId: '10', available: NaN }], locations)).toEqual([]);
    expect(planOpeningStockLines(variants, [{ inventoryItemId: '100', locationId: '10', available: 0 }], locations)[0].quantity).toBe(0);
  });

  it('selects only variants with a material adjustment at either location', () => {
    expect([...changedOpeningStockVariantIds([
      { variantId: 'already-synced', adjustment: 0 },
      { variantId: 'rounding-only', adjustment: 0.00001 },
      { variantId: 'warehouse-change', adjustment: 3 },
      { variantId: 'warehouse-change', adjustment: 0 },
      { variantId: 'kotara-change', adjustment: -2 },
    ])]).toEqual(['warehouse-change', 'kotara-change']);
  });
});
