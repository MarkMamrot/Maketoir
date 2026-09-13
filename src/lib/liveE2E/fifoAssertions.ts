export type FifoFixtureSnapshot = {
  method: 'average_cost' | 'fifo';
  activeEpochId: number | null;
  stockQuantity: number;
  layerQuantity: number;
  invalidLayerCount: number;
  unexplainedZeroCostCount: number;
  invalidAllocationCount: number;
  movementCoverageMismatchCount: number;
};

const QUANTITY_TOLERANCE = 0.0001;

function quantityDifference(left: number, right: number): number {
  return Math.abs(Math.round((left - right) * 10_000) / 10_000);
}

export function assertFifoFixtureSnapshot(snapshot: FifoFixtureSnapshot): void {
  const failures: string[] = [];
  if (snapshot.method !== 'fifo') failures.push(`costing method is ${snapshot.method}`);
  if (!Number.isInteger(snapshot.activeEpochId) || Number(snapshot.activeEpochId) <= 0) failures.push('active FIFO epoch is missing');
  if (quantityDifference(snapshot.stockQuantity, snapshot.layerQuantity) > QUANTITY_TOLERANCE) {
    failures.push(`fixture stock ${snapshot.stockQuantity} does not equal active layers ${snapshot.layerQuantity}`);
  }
  if (snapshot.invalidLayerCount > 0) failures.push(`${snapshot.invalidLayerCount} invalid FIFO layer(s)`);
  if (snapshot.unexplainedZeroCostCount > 0) failures.push(`${snapshot.unexplainedZeroCostCount} unexplained zero-cost layer(s)`);
  if (snapshot.invalidAllocationCount > 0) failures.push(`${snapshot.invalidAllocationCount} invalid FIFO allocation(s)`);
  if (snapshot.movementCoverageMismatchCount > 0) failures.push(`${snapshot.movementCoverageMismatchCount} FIFO movement coverage mismatch(es)`);

  if (failures.length > 0) throw new Error(`Live E2E blocked: FIFO integrity failed: ${failures.join('; ')}.`);
}