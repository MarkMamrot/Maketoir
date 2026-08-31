import { describe, expect, it } from 'vitest';
import { normalizeProductOpeningStockLines } from '../productOpeningStock';

describe('normalizeProductOpeningStockLines', () => {
  it('normalizes zero-valued stock metadata', () => {
    expect(normalizeProductOpeningStockLines([{ variantId: 'variant-1', locationId: 3, quantity: 0, minQty: 0, reorderQty: 0 }])).toEqual([
      { variantId: 'variant-1', locationId: 3, quantity: 0, minQty: 0, reorderQty: 0 },
    ]);
  });

  it('rejects negative quantities', () => {
    expect(() => normalizeProductOpeningStockLines([{ variantId: 'variant-1', locationId: 3, quantity: -1 }])).toThrow('must be zero or greater');
  });

  it('rejects duplicate variant and location entries', () => {
    expect(() => normalizeProductOpeningStockLines([
      { variantId: 'variant-1', locationId: 3, quantity: 1 },
      { variantId: 'variant-1', locationId: 3, quantity: 2 },
    ])).toThrow('can appear only once');
  });
});