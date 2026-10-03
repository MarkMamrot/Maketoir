import { describe, expect, it } from 'vitest';
import { summarizeSalesOrderCogs } from '../salesOrderCogs';

describe('summarizeSalesOrderCogs', () => {
  it('keeps a current-cost estimate separate from actual COGS for an unshipped line', () => {
    const summary = summarizeSalesOrderCogs([{
      qtyOrdered: 4,
      qtyFulfilled: 0,
      capturedUnitCost: null,
      estimatedUnitCost: 1.3829,
    }]);

    expect(summary).toMatchObject({
      actualCogs: 0,
      estimatedRemainingCogs: 5.5316,
      hasRemainingStock: true,
      allQuantitiesFulfilled: false,
      grossMarginAvailable: false,
    });
  });

  it('marks shipped zero-cost stock as unresolved instead of valid zero COGS', () => {
    const summary = summarizeSalesOrderCogs([{
      qtyOrdered: 4,
      qtyFulfilled: 4,
      capturedUnitCost: 0,
      estimatedUnitCost: 1.3829,
    }]);

    expect(summary.actualCogs).toBeNull();
    expect(summary.estimatedRemainingCogs).toBeNull();
    expect(summary.actualCostComplete).toBe(false);
    expect(summary.grossMarginAvailable).toBe(false);
  });

  it('counts captured shipment cost only and keeps outstanding estimate out of margin eligibility', () => {
    const summary = summarizeSalesOrderCogs([{
      qtyOrdered: 6,
      qtyFulfilled: 4,
      capturedUnitCost: 2.5,
      estimatedUnitCost: 3,
    }]);

    expect(summary.actualCogs).toBe(10);
    expect(summary.estimatedRemainingCogs).toBe(6);
    expect(summary.grossMarginAvailable).toBe(false);
  });

  it('allows gross margin only when all quantities have captured cost', () => {
    const summary = summarizeSalesOrderCogs([{
      qtyOrdered: 2,
      qtyFulfilled: 2,
      capturedUnitCost: 4,
      estimatedUnitCost: 5,
    }]);

    expect(summary.actualCogs).toBe(8);
    expect(summary.grossMarginAvailable).toBe(true);
  });

  it('excludes non-stock lines from COGS and remaining-stock estimates', () => {
    const summary = summarizeSalesOrderCogs([{
      qtyOrdered: 3,
      qtyFulfilled: 0,
      capturedUnitCost: null,
      estimatedUnitCost: 9,
      isStockItem: 0,
    }]);

    expect(summary.actualCogs).toBe(0);
    expect(summary.estimatedRemainingCogs).toBeNull();
    expect(summary.allQuantitiesFulfilled).toBe(false);
    expect(summary.grossMarginAvailable).toBe(false);
  });
});