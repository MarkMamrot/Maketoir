import { describe, expect, it } from 'vitest';
import { OrderAmendmentConflict, planStockRebalance, reconcileOrderLines } from '../orderAmendmentPlan';

describe('order amendment planning', () => {
  it('aggregates repeated variants into exact signed stock deltas', () => {
    expect(planStockRebalance(4, 4, [
      { variant_id: 'v-1', qty_ordered: 2 },
      { variant_id: 'v-1', qty_ordered: 3 },
    ], [
      { variant_id: 'v-1', qty_ordered: 3 },
    ])).toEqual([{ variantId: 'v-1', locationId: 4, quantityDelta: -2 }]);
  });

  it('plans a location move as an exact release and addition', () => {
    expect(planStockRebalance(4, 7,
      [{ variant_id: 'v-1', qty_ordered: 2 }],
      [{ variant_id: 'v-1', qty_ordered: 2 }],
    )).toEqual([
      { variantId: 'v-1', locationId: 4, quantityDelta: -2 },
      { variantId: 'v-1', locationId: 7, quantityDelta: 2 },
    ]);
  });

  it('does not create incoming-stock deltas for non-stock lines', () => {
    expect(planStockRebalance(4, 4, [
      { variant_id: 'stock', qty_ordered: 2, is_stock_item: 1 },
      { variant_id: 'expense', qty_ordered: 3, is_stock_item: 0 },
    ], [
      { variant_id: 'stock', qty_ordered: 4, is_stock_item: 1 },
      { variant_id: 'expense', qty_ordered: 8, is_stock_item: 0 },
    ])).toEqual([{ variantId: 'stock', locationId: 4, quantityDelta: 2 }]);
  });

  it('preserves explicit IDs and matches legacy requests by variant', () => {
    expect(reconcileOrderLines([
      { id: 10, variant_id: 'v-1' },
      { id: 11, variant_id: 'v-2' },
    ], [
      { id: 10, variant_id: 'v-3', qty_ordered: 1 },
      { variant_id: 'v-2', qty_ordered: 2 },
    ])).toEqual({
      lines: [
        { existingId: 10, line: { id: 10, variant_id: 'v-3', qty_ordered: 1 } },
        { existingId: 11, line: { variant_id: 'v-2', qty_ordered: 2 } },
      ],
      removedIds: [],
    });
  });

  it('rejects stale or foreign line IDs', () => {
    expect(() => reconcileOrderLines(
      [{ id: 10, variant_id: 'v-1' }],
      [{ id: 99, variant_id: 'v-1', qty_ordered: 1 }],
    )).toThrow(OrderAmendmentConflict);
  });
});