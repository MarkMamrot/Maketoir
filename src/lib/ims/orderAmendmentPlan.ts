export interface ExistingOrderLine {
  id: number;
  variant_id: string | null;
}

export interface RequestedOrderLine {
  id?: number;
  variant_id: string | null;
  qty_ordered: number;
}

export interface ReconciledOrderLine<T extends RequestedOrderLine> {
  existingId: number | null;
  line: T;
}

export interface StockQuantityLine {
  variant_id: string | null;
  qty_ordered: number;
}

export interface StockRebalanceDelta {
  variantId: string;
  locationId: number;
  quantityDelta: number;
}

export class OrderAmendmentConflict extends Error {
  readonly code = 'order_amendment_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'OrderAmendmentConflict';
  }
}

export function reconcileOrderLines<T extends RequestedOrderLine>(
  existingLines: ExistingOrderLine[],
  requestedLines: T[],
): { lines: ReconciledOrderLine<T>[]; removedIds: number[] } {
  const existingById = new Map(existingLines.map(line => [Number(line.id), line]));
  const unusedIds = new Set(existingLines.map(line => Number(line.id)));
  const sameVariantQueues = new Map<string, number[]>();

  for (const line of existingLines) {
    const key = String(line.variant_id ?? '');
    const queue = sameVariantQueues.get(key) ?? [];
    queue.push(Number(line.id));
    sameVariantQueues.set(key, queue);
  }

  const lines = requestedLines.map(line => {
    if (line.id != null) {
      const requestedId = Number(line.id);
      if (!existingById.has(requestedId) || !unusedIds.has(requestedId)) {
        throw new OrderAmendmentConflict(`Order line ${requestedId} is stale or does not belong to this order.`);
      }
      unusedIds.delete(requestedId);
      return { existingId: requestedId, line };
    }

    const queue = sameVariantQueues.get(String(line.variant_id ?? '')) ?? [];
    const matchedId = queue.find(id => unusedIds.has(id)) ?? null;
    if (matchedId != null) unusedIds.delete(matchedId);
    return { existingId: matchedId, line };
  });

  return { lines, removedIds: [...unusedIds] };
}

export function planStockRebalance(
  oldLocationId: number,
  newLocationId: number,
  oldLines: StockQuantityLine[],
  newLines: StockQuantityLine[],
): StockRebalanceDelta[] {
  const quantities = new Map<string, { variantId: string; locationId: number; oldQty: number; newQty: number }>();
  const add = (locationId: number, lines: StockQuantityLine[], side: 'oldQty' | 'newQty') => {
    for (const line of lines) {
      if (!line.variant_id) continue;
      const variantId = String(line.variant_id);
      const key = `${locationId}\u0000${variantId}`;
      const current = quantities.get(key) ?? { variantId, locationId, oldQty: 0, newQty: 0 };
      current[side] += Number(line.qty_ordered ?? 0);
      quantities.set(key, current);
    }
  };

  add(oldLocationId, oldLines, 'oldQty');
  add(newLocationId, newLines, 'newQty');

  return [...quantities.values()]
    .map(entry => ({
      variantId: entry.variantId,
      locationId: entry.locationId,
      quantityDelta: entry.newQty - entry.oldQty,
    }))
    .filter(entry => Math.abs(entry.quantityDelta) > 0.00005)
    .sort((left, right) => left.locationId - right.locationId || left.variantId.localeCompare(right.variantId));
}