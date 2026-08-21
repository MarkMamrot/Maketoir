import { describe, expect, it } from 'vitest';
import { planPosStockChange } from '../posStockFloor';

describe('planPosStockChange', () => {
  it('pairs an adjustment with the full sale when recorded SOH is insufficient', () => {
    expect(planPosStockChange(0, -1)).toEqual({
      requestedChange: -1,
      uncappedResultingOnHand: -1,
      automaticAdjustmentQuantity: 1,
      afterAdjustmentOnHand: 1,
      resultingOnHand: 0,
    });
  });

  it('adjusts only the uncovered portion of a sale', () => {
    expect(planPosStockChange(1, -3)).toMatchObject({
      automaticAdjustmentQuantity: 2,
      afterAdjustmentOnHand: 3,
      resultingOnHand: 0,
    });
  });

  it('leaves covered sales and returns unchanged', () => {
    expect(planPosStockChange(3, -2)).toMatchObject({ automaticAdjustmentQuantity: 0, resultingOnHand: 1 });
    expect(planPosStockChange(0, 2)).toMatchObject({ automaticAdjustmentQuantity: 0, resultingOnHand: 2 });
  });
});