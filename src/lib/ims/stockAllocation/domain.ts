const QUANTITY_SCALE = 10_000;

export type AllocationDemand = {
  soId: number;
  soItemId: number;
  variantId: string;
  locationId: number;
  orderedQuantity: number;
  fulfilledQuantity?: number;
  activeAllocatedQuantity?: number;
  requiredDate?: string | null;
  confirmedAt: string;
  isStockItem?: boolean;
};

export type DemandReadinessInput = {
  soId: number;
  soItemId: number;
  variantId: string;
  locationId: number;
  requiredDate?: string | null;
  createdAt: string;
  outstandingQuantity: number;
  activeAllocatedQuantity?: number;
  receivedAssignedQuantity?: number;
  allocationFulfilledQuantity?: number;
};

export type DemandReadiness = {
  soId: number;
  soItemId: number;
  priorityPosition: number;
  outstandingQuantity: number;
  protectedQuantity: number;
  protectedReadyQuantity: number;
  protectedReadyCoveredQuantity: number;
  protectedIncomingQuantity: number;
  priorityReadyQuantity: number;
  higherPriorityReadyQuantity: number;
  protectedReadyReservedForOthers: number;
  readyNowQuantity: number;
  shortfallNowQuantity: number;
  unsourcedQuantity: number;
};

export type AllocationSupply = {
  poId: number;
  poItemId: number;
  variantId: string;
  locationId: number;
  orderedQuantity: number;
  receivedQuantity?: number;
  activeAllocatedQuantity?: number;
  expectedDate?: string | null;
  status: string;
};

export type AllocationSuggestion = {
  soId: number;
  soItemId: number;
  poId: number;
  poItemId: number;
  variantId: string;
  locationId: number;
  quantity: number;
  expectedDate: string | null;
};

function scaledQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Quantity must be finite.');
  return Math.round(value * QUANTITY_SCALE);
}

function quantity(value: number): number {
  return value / QUANTITY_SCALE;
}

function demandPriority(left: { requiredDate?: string | null; createdAt: string; soId: number; soItemId: number }, right: { requiredDate?: string | null; createdAt: string; soId: number; soItemId: number }): number {
  return String(left.requiredDate ?? '9999-12-31').localeCompare(String(right.requiredDate ?? '9999-12-31'))
    || left.createdAt.localeCompare(right.createdAt)
    || left.soId - right.soId
    || left.soItemId - right.soItemId;
}

export function buildDemandReadiness(
  demands: DemandReadinessInput[],
  stockByVariantLocation: Array<{ variantId: string; locationId: number; quantityOnHand: number }>,
): DemandReadiness[] {
  const groups = new Map<string, DemandReadinessInput[]>();
  for (const demand of demands) {
    const key = `${demand.locationId}\u0000${demand.variantId}`;
    groups.set(key, [...(groups.get(key) ?? []), demand]);
  }
  const stock = new Map(stockByVariantLocation.map(row => [
    `${row.locationId}\u0000${row.variantId}`,
    Math.max(0, scaledQuantity(row.quantityOnHand)),
  ]));
  const results: DemandReadiness[] = [];

  for (const [key, group] of groups) {
    const ordered = [...group].sort(demandPriority);
    let physicalRemaining = stock.get(key) ?? 0;
    const prepared = ordered.map(demand => {
      const outstanding = Math.max(0, scaledQuantity(demand.outstandingQuantity));
      const allocated = Math.min(outstanding, Math.max(0,
        scaledQuantity(demand.activeAllocatedQuantity ?? 0) - scaledQuantity(demand.allocationFulfilledQuantity ?? 0),
      ));
      const received = Math.min(allocated, Math.max(0,
        scaledQuantity(demand.receivedAssignedQuantity ?? 0) - scaledQuantity(demand.allocationFulfilledQuantity ?? 0),
      ));
      return { demand, outstanding, allocated, received };
    });

    const protectedCoverage = new Map<number, number>();
    for (const row of prepared) {
      const covered = Math.min(row.received, physicalRemaining);
      protectedCoverage.set(row.demand.soItemId, covered);
      physicalRemaining -= covered;
    }
    const totalProtectedCovered = [...protectedCoverage.values()].reduce((sum, value) => sum + value, 0);
    let higherPriorityReady = 0;

    prepared.forEach((row, index) => {
      const protectedCovered = protectedCoverage.get(row.demand.soItemId) ?? 0;
      const unprotectedDemand = Math.max(0, row.outstanding - row.allocated);
      const priorityReady = Math.min(unprotectedDemand, physicalRemaining);
      physicalRemaining -= priorityReady;
      const readyNow = protectedCovered + priorityReady;
      results.push({
        soId: row.demand.soId,
        soItemId: row.demand.soItemId,
        priorityPosition: index + 1,
        outstandingQuantity: quantity(row.outstanding),
        protectedQuantity: quantity(row.allocated),
        protectedReadyQuantity: quantity(row.received),
        protectedReadyCoveredQuantity: quantity(protectedCovered),
        protectedIncomingQuantity: quantity(Math.max(0, row.allocated - row.received)),
        priorityReadyQuantity: quantity(priorityReady),
        higherPriorityReadyQuantity: quantity(higherPriorityReady),
        protectedReadyReservedForOthers: quantity(Math.max(0, totalProtectedCovered - protectedCovered)),
        readyNowQuantity: quantity(readyNow),
        shortfallNowQuantity: quantity(Math.max(0, row.outstanding - readyNow)),
        unsourcedQuantity: quantity(Math.max(0, row.outstanding - row.allocated)),
      });
      higherPriorityReady += readyNow;
    });
  }

  return results;
}

export function calculateStockAvailability(input: {
  quantityOnHand: number;
  quantityCommitted: number;
  incomingOutstanding: number;
  incomingAllocated: number;
}) {
  const onHand = scaledQuantity(input.quantityOnHand);
  const committed = scaledQuantity(input.quantityCommitted);
  const incoming = scaledQuantity(input.incomingOutstanding);
  const allocated = scaledQuantity(input.incomingAllocated);
  return {
    availableNow: quantity(Math.max(0, onHand - committed)),
    incomingFree: quantity(Math.max(0, incoming - allocated)),
  };
}

export function calculateDemandAvailability(input: {
  orderedQuantity: number;
  fulfilledQuantity: number;
  activeAllocatedQuantity: number;
  receivedAssignedQuantity: number;
}) {
  const outstanding = Math.max(
    0,
    scaledQuantity(input.orderedQuantity) - scaledQuantity(input.fulfilledQuantity),
  );
  const allocated = Math.min(outstanding, Math.max(0, scaledQuantity(input.activeAllocatedQuantity)));
  const ready = Math.min(allocated, Math.max(0, scaledQuantity(input.receivedAssignedQuantity)));
  return {
    outstandingQuantity: quantity(outstanding),
    allocatedIncomingQuantity: quantity(allocated),
    readyFromIncomingQuantity: quantity(ready),
    unsourcedQuantity: quantity(Math.max(0, outstanding - allocated)),
  };
}

export function buildFifoAllocationSuggestions(
  demands: AllocationDemand[],
  supplies: AllocationSupply[],
): AllocationSuggestion[] {
  const remainingSupply = new Map<number, number>();
  for (const supply of supplies) {
    const eligible = supply.status === 'confirmed' || supply.status === 'partially_received';
    const outstanding = Math.max(
      0,
      scaledQuantity(supply.orderedQuantity) - scaledQuantity(supply.receivedQuantity ?? 0),
    );
    remainingSupply.set(
      supply.poItemId,
      eligible ? Math.max(0, outstanding - scaledQuantity(supply.activeAllocatedQuantity ?? 0)) : 0,
    );
  }

  const orderedDemands = [...demands].sort((left, right) => demandPriority(
    { ...left, createdAt: left.confirmedAt },
    { ...right, createdAt: right.confirmedAt },
  ));
  const orderedSupplies = [...supplies].sort((left, right) =>
    String(left.expectedDate ?? '9999-12-31').localeCompare(String(right.expectedDate ?? '9999-12-31'))
    || left.poId - right.poId
    || left.poItemId - right.poItemId,
  );
  const suggestions: AllocationSuggestion[] = [];

  for (const demand of orderedDemands) {
    if (demand.isStockItem === false) continue;
    let remainingDemand = Math.max(
      0,
      scaledQuantity(demand.orderedQuantity)
        - scaledQuantity(demand.fulfilledQuantity ?? 0)
        - scaledQuantity(demand.activeAllocatedQuantity ?? 0),
    );
    if (remainingDemand === 0) continue;

    for (const supply of orderedSupplies) {
      if (supply.variantId !== demand.variantId || supply.locationId !== demand.locationId) continue;
      const availableSupply = remainingSupply.get(supply.poItemId) ?? 0;
      if (availableSupply === 0) continue;
      const allocated = Math.min(remainingDemand, availableSupply);
      suggestions.push({
        soId: demand.soId,
        soItemId: demand.soItemId,
        poId: supply.poId,
        poItemId: supply.poItemId,
        variantId: demand.variantId,
        locationId: demand.locationId,
        quantity: quantity(allocated),
        expectedDate: supply.expectedDate ?? null,
      });
      remainingDemand -= allocated;
      remainingSupply.set(supply.poItemId, availableSupply - allocated);
      if (remainingDemand === 0) break;
    }
  }

  return suggestions;
}