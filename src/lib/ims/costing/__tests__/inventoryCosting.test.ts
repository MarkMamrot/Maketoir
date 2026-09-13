import { describe, expect, it } from 'vitest';

import {
  INVENTORY_QUANTITY_INCREMENT,
  inventoryQuantitiesEqual,
  isInventoryCostMethod,
  planFifoConsumption,
  quantizeInventoryQuantity,
} from '../inventoryCosting';

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

  it('normalizes quantities to the four-decimal database contract', () => {
    expect(INVENTORY_QUANTITY_INCREMENT).toBe(0.0001);
    expect(quantizeInventoryQuantity(1.23454)).toBe(1.2345);
    expect(quantizeInventoryQuantity(1.23456)).toBe(1.2346);
    expect(inventoryQuantitiesEqual(2, 2.000049)).toBe(true);
    expect(inventoryQuantitiesEqual(2, 2.0001)).toBe(false);
  });

  it('does not allocate a request that rounds below one storage unit', () => {
    expect(() => planFifoConsumption([
      { layerId: 1, fifoDate: '2026-01-01', remainingQuantity: 1, unitCost: 8 },
    ], 0.000049)).toThrow('Requested quantity must be greater than zero.');
  });

  it('conserves normalized quantity and value across deterministic generated cases', () => {
    let seed = 938_471;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    for (let scenario = 0; scenario < 200; scenario++) {
      const layers = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, index) => ({
        layerId: index + 1,
        fifoDate: new Date(Date.UTC(2026, 0, 1 + Math.floor(random() * 30))).toISOString(),
        remainingQuantity: quantizeInventoryQuantity(random() * 20),
        unitCost: Math.round(random() * 100_000) / 1_000,
      }));
      const available = layers.reduce((sum, layer) => sum + layer.remainingQuantity, 0);
      const requested = quantizeInventoryQuantity(Math.max(0.0001, random() * (available + 5)));
      const plan = planFifoConsumption(layers, requested);
      expect(plan.allocatedQuantity + plan.shortageQuantity).toBeCloseTo(plan.requestedQuantity, 10);
      expect(plan.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0))
        .toBeCloseTo(plan.allocatedQuantity, 10);
      expect(plan.allocations.reduce((sum, allocation) => sum + allocation.allocatedValue, 0))
        .toBeCloseTo(plan.allocatedValue, 8);
      expect(plan.allocations.every(allocation => allocation.quantity > 0)).toBe(true);
    }
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