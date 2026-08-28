import { describe, expect, it } from 'vitest';
import { changedOpeningStockVariantIds, planOpeningStockLines, resolveOpeningStockLocations } from '../shopifyOpeningStock';

describe('Shopify opening stock', () => {
  it('maps Warehouse and Kotara by exact normalized location name', () => {
    expect(resolveOpeningStockLocations(
      [{ id: 10, name: ' warehouse ', active: true }, { id: 20, name: 'KOTARA', active: true }],
      [{ id: 1, name: 'Warehouse', active: 1 }, { id: 2, name: 'Kotara', active: 1 }],
    )).toEqual([
      { name: 'Warehouse', shopifyLocationId: 10, solvantisLocationId: 1 },
      { name: 'Kotara', shopifyLocationId: 20, solvantisLocationId: 2 },
    ]);
  });

  it('refuses missing or duplicate mapped locations', () => {
    expect(() => resolveOpeningStockLocations(
      [{ id: 10, name: 'Warehouse', active: true }],
      [{ id: 1, name: 'Warehouse' }, { id: 2, name: 'Kotara' }],
    )).toThrow('Shopify location named Kotara');
  });

  it('keeps location quantities separate, treats absent levels as zero, and clamps negatives', () => {
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
      expect.objectContaining({ variantId: 'v2', locationName: 'Kotara', quantity: 0, wasNegative: false }),
    ]);
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
