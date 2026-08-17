import { describe, expect, it } from 'vitest';
import {
  buildFifoAllocationSuggestions,
  calculateDemandAvailability,
  calculateStockAvailability,
} from '../stockAllocation/domain';

describe('stock allocation domain', () => {
  it('separates available-now and free incoming quantities', () => {
    expect(calculateStockAvailability({
      quantityOnHand: 7,
      quantityCommitted: 10,
      incomingOutstanding: 30,
      incomingAllocated: 18,
    })).toEqual({ availableNow: 0, incomingFree: 12 });
  });

  it('reports ready, allocated, and unsourced demand without exceeding outstanding quantity', () => {
    expect(calculateDemandAvailability({
      orderedQuantity: 10,
      fulfilledQuantity: 3,
      activeAllocatedQuantity: 5,
      receivedAssignedQuantity: 2,
    })).toEqual({
      outstandingQuantity: 7,
      allocatedIncomingQuantity: 5,
      readyFromIncomingQuantity: 2,
      unsourcedQuantity: 2,
    });
  });

  it('allocates three FIFO demands across two incoming drops without over-allocation', () => {
    const suggestions = buildFifoAllocationSuggestions([
      { soId: 1, soItemId: 11, variantId: 'x', locationId: 4, orderedQuantity: 10, confirmedAt: '2026-08-01T09:00:00Z' },
      { soId: 2, soItemId: 21, variantId: 'x', locationId: 4, orderedQuantity: 10, confirmedAt: '2026-08-02T09:00:00Z' },
      { soId: 3, soItemId: 31, variantId: 'x', locationId: 4, orderedQuantity: 10, confirmedAt: '2026-08-03T09:00:00Z' },
    ], [
      { poId: 5, poItemId: 51, variantId: 'x', locationId: 4, orderedQuantity: 18, expectedDate: '2026-09-01', status: 'confirmed' },
      { poId: 6, poItemId: 61, variantId: 'x', locationId: 4, orderedQuantity: 12, expectedDate: '2026-09-15', status: 'confirmed' },
    ]);

    expect(suggestions.map(row => [row.soItemId, row.poItemId, row.quantity])).toEqual([
      [11, 51, 10],
      [21, 51, 8],
      [21, 61, 2],
      [31, 61, 10],
    ]);
  });

  it('uses stable FIFO ties and excludes draft, mismatched, and non-stock supply demand', () => {
    const suggestions = buildFifoAllocationSuggestions([
      { soId: 2, soItemId: 22, variantId: 'x', locationId: 1, orderedQuantity: 2, confirmedAt: '2026-08-01' },
      { soId: 1, soItemId: 12, variantId: 'x', locationId: 1, orderedQuantity: 2, confirmedAt: '2026-08-01' },
      { soId: 3, soItemId: 32, variantId: 'x', locationId: 1, orderedQuantity: 2, confirmedAt: '2026-08-01', isStockItem: false },
    ], [
      { poId: 1, poItemId: 10, variantId: 'x', locationId: 1, orderedQuantity: 2, status: 'draft' },
      { poId: 2, poItemId: 20, variantId: 'x', locationId: 2, orderedQuantity: 2, status: 'confirmed' },
      { poId: 3, poItemId: 30, variantId: 'x', locationId: 1, orderedQuantity: 3, status: 'partially_received' },
    ]);

    expect(suggestions.map(row => [row.soId, row.quantity])).toEqual([[1, 2], [2, 1]]);
  });

  it('uses four-decimal quantity precision and existing allocations', () => {
    expect(buildFifoAllocationSuggestions([
      { soId: 1, soItemId: 1, variantId: 'x', locationId: 1, orderedQuantity: 1.1111, activeAllocatedQuantity: 0.1111, confirmedAt: '2026-08-01' },
    ], [
      { poId: 1, poItemId: 1, variantId: 'x', locationId: 1, orderedQuantity: 1.5555, receivedQuantity: 0.2222, activeAllocatedQuantity: 0.3333, status: 'confirmed' },
    ])[0]?.quantity).toBe(1);
  });
});