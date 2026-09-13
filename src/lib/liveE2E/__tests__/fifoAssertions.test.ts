import { describe, expect, it } from 'vitest';

import { assertFifoFixtureSnapshot, type FifoFixtureSnapshot } from '../fifoAssertions';

const balanced: FifoFixtureSnapshot = {
  method: 'fifo',
  activeEpochId: 41,
  stockQuantity: 3.0001,
  layerQuantity: 3,
  invalidLayerCount: 0,
  unexplainedZeroCostCount: 0,
  invalidAllocationCount: 0,
  movementCoverageMismatchCount: 0,
};

describe('live E2E FIFO assertions', () => {
  it('accepts a balanced FIFO fixture within storage precision', () => {
    expect(() => assertFifoFixtureSnapshot(balanced)).not.toThrow();
  });

  it('blocks a missing FIFO epoch and stock-to-layer mismatch', () => {
    expect(() => assertFifoFixtureSnapshot({
      ...balanced,
      method: 'average_cost',
      activeEpochId: null,
      layerQuantity: 2.5,
    })).toThrow('costing method is average_cost; active FIFO epoch is missing; fixture stock 3.0001 does not equal active layers 2.5');
  });

  it('reports every persisted integrity count in one actionable failure', () => {
    expect(() => assertFifoFixtureSnapshot({
      ...balanced,
      invalidLayerCount: 1,
      unexplainedZeroCostCount: 2,
      invalidAllocationCount: 3,
      movementCoverageMismatchCount: 4,
    })).toThrow('1 invalid FIFO layer(s); 2 unexplained zero-cost layer(s); 3 invalid FIFO allocation(s); 4 FIFO movement coverage mismatch(es)');
  });
});