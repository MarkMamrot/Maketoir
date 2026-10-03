import { describe, expect, it } from 'vitest';
import {
  buildDemandReadiness,
  buildFifoAllocationSuggestions,
  calculateDemandAvailability,
  calculateStockAvailability,
} from '../stockAllocation/domain';

describe('stock allocation domain', () => {
  it('reserves protected receipts before assigning free on-hand stock by required date and age', () => {
    const readiness = buildDemandReadiness([
      { soId: 1, soItemId: 11, variantId: 'x', locationId: 4, requiredDate: '2026-10-10', createdAt: '2026-10-01', outstandingQuantity: 8 },
      { soId: 2, soItemId: 21, variantId: 'x', locationId: 4, requiredDate: '2026-10-08', createdAt: '2026-10-02', outstandingQuantity: 7, activeAllocatedQuantity: 4, receivedAssignedQuantity: 3 },
      { soId: 3, soItemId: 31, variantId: 'x', locationId: 4, requiredDate: null, createdAt: '2026-09-01', outstandingQuantity: 6 },
    ], [{ variantId: 'x', locationId: 4, quantityOnHand: 10 }]);

    expect(readiness).toEqual([
      expect.objectContaining({ soItemId: 21, priorityPosition: 1, protectedReadyQuantity: 3, protectedReadyCoveredQuantity: 3, priorityReadyQuantity: 3, readyNowQuantity: 6, shortfallNowQuantity: 1 }),
      expect.objectContaining({ soItemId: 11, priorityPosition: 2, protectedReadyQuantity: 0, priorityReadyQuantity: 4, readyNowQuantity: 4, shortfallNowQuantity: 4 }),
      expect.objectContaining({ soItemId: 31, priorityPosition: 3, readyNowQuantity: 0, shortfallNowQuantity: 6 }),
    ]);
    expect(readiness.reduce((sum, row) => sum + row.readyNowQuantity, 0)).toBe(10);
  });

  it('does not report the same received protected stock as free priority stock', () => {
    const readiness = buildDemandReadiness([
      { soId: 1, soItemId: 11, variantId: 'x', locationId: 4, requiredDate: '2026-10-01', createdAt: '2026-09-01', outstandingQuantity: 5, activeAllocatedQuantity: 5, receivedAssignedQuantity: 5 },
      { soId: 2, soItemId: 21, variantId: 'x', locationId: 4, requiredDate: '2026-10-02', createdAt: '2026-09-02', outstandingQuantity: 5 },
    ], [{ variantId: 'x', locationId: 4, quantityOnHand: 5 }]);

    expect(readiness.map(row => [row.soItemId, row.readyNowQuantity])).toEqual([[11, 5], [21, 0]]);
  });

  it('caps protected readiness at physical stock when earlier fulfilment consumed it', () => {
    const readiness = buildDemandReadiness([
      { soId: 1, soItemId: 11, variantId: 'x', locationId: 4, requiredDate: '2026-10-01', createdAt: '2026-09-01', outstandingQuantity: 4, activeAllocatedQuantity: 4, receivedAssignedQuantity: 4 },
      { soId: 2, soItemId: 21, variantId: 'x', locationId: 4, requiredDate: '2026-10-02', createdAt: '2026-09-02', outstandingQuantity: 4, activeAllocatedQuantity: 4, receivedAssignedQuantity: 4 },
    ], [{ variantId: 'x', locationId: 4, quantityOnHand: 5 }]);

    expect(readiness.map(row => [row.soItemId, row.protectedReadyQuantity, row.protectedReadyCoveredQuantity, row.readyNowQuantity]))
      .toEqual([[11, 4, 4, 4], [21, 4, 1, 1]]);
  });

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

  it('prioritizes required date before confirmation time when suggesting incoming supply', () => {
    const suggestions = buildFifoAllocationSuggestions([
      { soId: 1, soItemId: 11, variantId: 'x', locationId: 4, orderedQuantity: 5, requiredDate: '2026-10-20', confirmedAt: '2026-09-01' },
      { soId: 2, soItemId: 21, variantId: 'x', locationId: 4, orderedQuantity: 5, requiredDate: '2026-10-10', confirmedAt: '2026-09-02' },
    ], [{ poId: 5, poItemId: 51, variantId: 'x', locationId: 4, orderedQuantity: 5, status: 'confirmed' }]);

    expect(suggestions.map(row => row.soItemId)).toEqual([21]);
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