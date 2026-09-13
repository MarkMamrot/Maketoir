export const INVENTORY_COST_METHODS = ['average_cost', 'fifo'] as const;

export type InventoryCostMethod = typeof INVENTORY_COST_METHODS[number];

export type FifoLayerCandidate = {
  layerId: number;
  fifoDate: string | Date;
  remainingQuantity: number;
  unitCost: number;
};

export type FifoAllocation = {
  layerId: number;
  quantity: number;
  unitCost: number;
  allocatedValue: number;
};

export type FifoAllocationPlan = {
  allocations: FifoAllocation[];
  requestedQuantity: number;
  allocatedQuantity: number;
  shortageQuantity: number;
  allocatedValue: number;
  weightedUnitCost: number | null;
};

export const INVENTORY_QUANTITY_SCALE = 10_000;
export const INVENTORY_QUANTITY_INCREMENT = 1 / INVENTORY_QUANTITY_SCALE;
export const INVENTORY_QUANTITY_TOLERANCE = INVENTORY_QUANTITY_INCREMENT / 2;
export const INVENTORY_UNIT_COST_SCALE = 1_000_000;

function scaledQuantity(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return Math.round(value * INVENTORY_QUANTITY_SCALE);
}

export function quantizeInventoryQuantity(value: number, label = 'Quantity'): number {
  return scaledQuantity(value, label) / INVENTORY_QUANTITY_SCALE;
}

export function inventoryQuantitiesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < INVENTORY_QUANTITY_TOLERANCE;
}

export function isDatabaseZeroInventoryCost(value: number): boolean {
  return Number.isFinite(value) && Math.round(value * INVENTORY_UNIT_COST_SCALE) === 0;
}

export function isInventoryCostMethod(value: unknown): value is InventoryCostMethod {
  return INVENTORY_COST_METHODS.includes(value as InventoryCostMethod);
}

export function planFifoConsumption(
  layers: readonly FifoLayerCandidate[],
  requestedQuantity: number,
): FifoAllocationPlan {
  const requestedScaled = scaledQuantity(requestedQuantity, 'Requested quantity');
  if (requestedScaled <= 0) throw new Error('Requested quantity must be greater than zero.');

  const ordered = layers.map(layer => {
    if (!Number.isInteger(layer.layerId) || layer.layerId <= 0) throw new Error('FIFO layer IDs must be positive integers.');
    const remainingScaled = scaledQuantity(layer.remainingQuantity, `FIFO layer ${layer.layerId} remaining quantity`);
    if (remainingScaled < 0) throw new Error(`FIFO layer ${layer.layerId} remaining quantity cannot be negative.`);
    if (!Number.isFinite(layer.unitCost) || layer.unitCost < 0) throw new Error(`FIFO layer ${layer.layerId} unit cost cannot be negative.`);
    const fifoTime = new Date(layer.fifoDate).getTime();
    if (!Number.isFinite(fifoTime)) throw new Error(`FIFO layer ${layer.layerId} has an invalid FIFO date.`);
    return { ...layer, fifoTime, remainingScaled };
  }).sort((left, right) => left.fifoTime - right.fifoTime || left.layerId - right.layerId);

  let remainingRequested = requestedScaled;
  const allocations: FifoAllocation[] = [];
  for (const layer of ordered) {
    if (remainingRequested === 0) break;
    const allocatedScaled = Math.min(remainingRequested, layer.remainingScaled);
    if (allocatedScaled === 0) continue;
    const quantity = allocatedScaled / INVENTORY_QUANTITY_SCALE;
    allocations.push({
      layerId: layer.layerId,
      quantity,
      unitCost: layer.unitCost,
      allocatedValue: quantity * layer.unitCost,
    });
    remainingRequested -= allocatedScaled;
  }

  const allocatedScaled = requestedScaled - remainingRequested;
  const allocatedQuantity = allocatedScaled / INVENTORY_QUANTITY_SCALE;
  const allocatedValue = allocations.reduce((sum, allocation) => sum + allocation.allocatedValue, 0);
  return {
    allocations,
    requestedQuantity: requestedScaled / INVENTORY_QUANTITY_SCALE,
    allocatedQuantity,
    shortageQuantity: remainingRequested / INVENTORY_QUANTITY_SCALE,
    allocatedValue,
    weightedUnitCost: allocatedScaled > 0 ? allocatedValue / allocatedQuantity : null,
  };
}