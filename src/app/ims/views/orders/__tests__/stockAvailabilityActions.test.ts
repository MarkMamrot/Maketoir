import { describe, expect, it } from 'vitest';
import { getFifoAllocationDraft } from '../stockAvailabilityActions';

describe('getFifoAllocationDraft', () => {
  it('uses the first eligible FIFO candidate and caps quantity at current unsourced demand', () => {
    expect(getFifoAllocationDraft([{
      soItemId: 10,
      unsourced: 3,
      candidates: [
        { poItemId: 20, poId: 2, poNumber: 'PO-2', expectedDate: '2026-08-20', freeQuantity: 5 },
        { poItemId: 30, poId: 3, poNumber: 'PO-3', expectedDate: '2026-08-25', freeQuantity: 8 },
      ],
    }], 10)).toEqual({
      candidate: { poItemId: 20, poId: 2, poNumber: 'PO-2', expectedDate: '2026-08-20', freeQuantity: 5 },
      maxQuantity: 3,
    });
  });

  it('caps quantity at FIFO free supply and ignores exhausted candidates', () => {
    expect(getFifoAllocationDraft([{
      soItemId: 10,
      unsourced: 7,
      candidates: [
        { poItemId: 20, poId: 2, poNumber: 'PO-2', expectedDate: '2026-08-20', freeQuantity: 0 },
        { poItemId: 30, poId: 3, poNumber: 'PO-3', expectedDate: '2026-08-25', freeQuantity: 2 },
      ],
    }], 10)?.maxQuantity).toBe(2);
  });

  it('returns null when current demand has no eligible supply', () => {
    expect(getFifoAllocationDraft([{ soItemId: 10, unsourced: 0, candidates: [] }], 10)).toBeNull();
  });
});