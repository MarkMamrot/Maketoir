import { describe, expect, it } from 'vitest';
import { planPurchaseOrderReceive } from '../purchaseOrderReceivePlan';

const line = (enteredQuantity: number, alreadyReceivedQuantity = 0) => ({
  variantId: 'v-1',
  orderedQuantity: 10,
  alreadyReceivedQuantity,
  enteredQuantity,
});

describe('planPurchaseOrderReceive', () => {
  it('saves only the new delta during partial receiving', () => {
    expect(planPurchaseOrderReceive([line(6, 2)], 'partially_received')).toEqual({
      receivedItems: [{ variant_id: 'v-1', qty_received: 4 }],
      shouldCallBatch: true,
      markPoReceived: false,
      createBackorderPo: false,
      shortfallLineCount: 1,
    });
  });

  it('lets the batch route own complete receipt finalization', () => {
    expect(planPurchaseOrderReceive([line(10)], 'complete')).toMatchObject({
      receivedItems: [{ variant_id: 'v-1', qty_received: 10 }],
      shouldCallBatch: true,
      markPoReceived: true,
      createBackorderPo: false,
    });
  });

  it('creates a held supplier backorder when finalizing with a shortfall', () => {
    expect(planPurchaseOrderReceive([line(4)], 'complete')).toMatchObject({
      receivedItems: [{ variant_id: 'v-1', qty_received: 4 }],
      shouldCallBatch: true,
      markPoReceived: true,
      createBackorderPo: true,
      shortfallLineCount: 1,
    });
  });

  it('never reverses quantities already received', () => {
    expect(planPurchaseOrderReceive([line(2, 5)], 'partially_received').receivedItems).toEqual([]);
  });
});