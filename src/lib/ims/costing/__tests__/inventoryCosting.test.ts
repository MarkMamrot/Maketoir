import { describe, expect, it } from 'vitest';

import { isInventoryCostMethod, planFifoConsumption } from '../inventoryCosting';

describe('inventory costing', () => {
  it('recognises supported tenant-wide costing methods', () => {
    expect(isInventoryCostMethod('average_cost')).toBe(true);
    expect(isInventoryCostMethod('fifo')).toBe(true);
    expect(isInventoryCostMethod('lifo')).toBe(false);
  });

  it('consumes oldest layers first and calculates a weighted movement cost', () => {
    const plan = planFifoConsumption([
      { layerId: 3, fifoDate: '2026-03-01T00:00:00Z', remainingQuantity: 5, unitCost: 14 },
      { layerId: 1, fifoDate: '2026-01-01T00:00:00Z', remainingQuantity: 2, unitCost: 10 },
      { layerId: 2, fifoDate: '2026-02-01T00:00:00Z', remainingQuantity: 4, unitCost: 12 },
    ], 5);

    expect(plan.allocations).toEqual([
      { layerId: 1, quantity: 2, unitCost: 10, allocatedValue: 20 },
      { layerId: 2, quantity: 3, unitCost: 12, allocatedValue: 36 },
    ]);
    expect(plan.shortageQuantity).toBe(0);
    expect(plan.weightedUnitCost).toBeCloseTo(11.2, 10);
  });

  it('uses layer ID as the stable tie-breaker for equal FIFO dates', () => {
    const plan = planFifoConsumption([
      { layerId: 9, fifoDate: '2026-01-01', remainingQuantity: 1, unitCost: 9 },
      { layerId: 4, fifoDate: '2026-01-01', remainingQuantity: 1, unitCost: 4 },
    ], 1);

    expect(plan.allocations).toEqual([
      { layerId: 4, quantity: 1, unitCost: 4, allocatedValue: 4 },
    ]);
  });

  it('reports an exact fractional shortage without inventing a provisional cost', () => {
    const plan = planFifoConsumption([
      { layerId: 1, fifoDate: '2026-01-01', remainingQuantity: 1.125, unitCost: 8.5 },
    ], 1.375);

    expect(plan.allocatedQuantity).toBe(1.125);
    expect(plan.shortageQuantity).toBe(0.25);
    expect(plan.weightedUnitCost).toBe(8.5);
  });

  it('rejects invalid requests and corrupt layers', () => {
    expect(() => planFifoConsumption([], 0)).toThrow('Requested quantity must be greater than zero.');
    expect(() => planFifoConsumption([
      { layerId: 1, fifoDate: '2026-01-01', remainingQuantity: -1, unitCost: 8 },
    ], 1)).toThrow('remaining quantity cannot be negative');
    expect(() => planFifoConsumption([
      { layerId: 1, fifoDate: 'invalid', remainingQuantity: 1, unitCost: 8 },
    ], 1)).toThrow('invalid FIFO date');
  });
});