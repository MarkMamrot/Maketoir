import { computeAverageCostAfterReversal, computeWeightedAverageCost } from './avgCostMath';

export type ValuationMethod = 'average_cost' | 'fifo';
export type ValuationCostSource = 'historical' | 'current_fallback' | 'uncosted';

export interface ValuationRow {
  variant_id: string;
  sku: string;
  name: string;
  brand: string | null;
  supplier_name: string | null;
  cost: number;
  soh: number;
  total_value: number;
  layer_quantity: number | null;
  reconciliation_delta: number;
  cost_source?: ValuationCostSource;
  inferred_opening?: boolean;
}

export interface ValuationWarnings {
  current_cost_sku_count: number;
  uncosted_sku_count: number;
  inferred_opening_sku_count: number;
  incomplete_history_sku_count: number;
  negative_position_count: number;
}

export interface ValuationReconciliation {
  status: 'balanced' | 'mismatch';
  mismatched_sku_count: number;
  mismatched_location_count: number;
  stock_quantity: number;
  valued_quantity: number;
  mismatches: Array<{
    variant_id: string;
    location_id: number;
    stock_quantity: number;
    layer_quantity: number;
    reconciliation_delta: number;
  }>;
}

export interface ValuationResult {
  success: true;
  data: ValuationRow[];
  costing_method: ValuationMethod;
  cost_epoch_id: number | null;
  reconciliation: ValuationReconciliation;
  as_at: string;
  business_today: string;
  time_zone: string;
  historical: boolean;
  warnings?: ValuationWarnings;
}

export class ValuationDateError extends Error {}

export function valuationCostLabel(source?: ValuationCostSource): string {
  if (source === 'historical') return 'Historical cost';
  if (source === 'current_fallback') return "Today's cost (estimate)";
  if (source === 'uncosted') return 'Cost unavailable';
  return 'Current cost';
}

export function inventoryValuationCsv(result: ValuationResult): string {
  const headers = ['As At Date', 'Timezone', 'SKU', 'Product Name', 'Brand', 'Supplier',
    result.costing_method === 'fifo' ? 'FIFO Unit Cost' : 'Average Unit Cost',
    'SOH', 'Total Value', 'Cost Source', 'Inferred Opening Stock'];
  const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return [headers, ...result.data.map(row => [
    result.as_at, result.time_zone, row.sku, row.name, row.brand ?? '', row.supplier_name ?? '',
    row.cost_source === 'uncosted' ? '' : row.cost, row.soh,
    row.cost_source === 'uncosted' ? '' : row.total_value,
    valuationCostLabel(row.cost_source), row.inferred_opening ? 'Yes' : 'No',
  ])].map(line => line.map(csvCell).join(',')).join('\r\n');
}
export function valuationDate(value: string | null, timeZone: string, now = new Date()) {
  const today = now.toLocaleDateString('sv-SE', { timeZone });
  const asAt = value ?? today;
  const date = new Date(`${asAt}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== asAt || asAt < '1000-01-01') {
    throw new ValuationDateError('As at date must be a valid date in YYYY-MM-DD format.');
  }
  if (asAt > today) throw new ValuationDateError('As at date cannot be in the future.');
  date.setUTCDate(date.getUTCDate() + 1);
  const target = date.getTime();
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second));
    const difference = local - target;
    instant -= difference;
    if (difference === 0) break;
    if (attempt === 3) throw new Error('Cannot resolve the inventory valuation date in the business timezone.');
  }
  return {
    asAt, today, historical: asAt < today,
    cutoff: new Date(instant).toISOString().slice(0, 23).replace('T', ' '),
  };
}

export interface HistoricalVariant {
  variant_id: string;
  sku: string;
  name: string;
  brand: string | null;
  supplier_name: string | null;
  created_at: string;
  current_cost: number | null;
}

export interface HistoricalStock {
  variant_id: string;
  location_id: number;
  qty_on_hand: number;
}

export interface HistoricalMovement {
  id: number;
  variant_id: string;
  location_id: number;
  movement_type: string;
  qty_change: number;
  qty_after_soh: number;
  unit_cost: number | null;
  cost_method_snapshot: ValuationMethod;
  cost_epoch_id: number | null;
  created_at: string;
  average_cost_after: number | null;
  cost_repaired: boolean;
}

export interface HistoricalEpoch {
  id: number;
  method: ValuationMethod;
  started_at: string;
}

export interface HistoricalLayer {
  id: number;
  variant_id: string;
  location_id: number;
  original_quantity: number;
  unit_cost: number;
  created_at: string;
  allocations: Array<{ quantity: number; allocation_type: string; created_at: string }>;
}

const NON_PHYSICAL = new Set(['po_approved', 'so_confirmed', 'so_committed', 'so_unconfirmed', 'so_uncommitted']);
const TOLERANCE = 0.0001;
const roundedCost = (value: number) => Math.round(value * 10_000) / 10_000;
const roundedQty = (value: number) => Math.round(value * 10_000) / 10_000;
const timestamp = (value: string) => {
  const [seconds, fraction = ''] = value.replace('T', ' ').replace(/Z$/, '').split('.');
  return `${seconds}.${fraction.padEnd(3, '0').slice(0, 3)}`;
};

export function physicalMovementDelta(movement: HistoricalMovement): number {
  if (NON_PHYSICAL.has(movement.movement_type)
    || (movement.movement_type === 'po_unapproved' && movement.unit_cost == null)) return 0;
  return movement.qty_change;
}

export function reconstructLayer(layer: HistoricalLayer, cutoff: string): number {
  if (timestamp(layer.created_at) >= timestamp(cutoff)) return 0;
  let quantity = layer.original_quantity;
  for (const allocation of layer.allocations) {
    if (timestamp(allocation.created_at) >= timestamp(cutoff)) continue;
    if (allocation.allocation_type === 'restore') quantity += allocation.quantity;
    else if (allocation.allocation_type === 'consume' || allocation.allocation_type === 'reverse_inbound') {
      quantity -= allocation.quantity;
    } else {
      throw new Error(`Unsupported FIFO allocation type: ${allocation.allocation_type}`);
    }
  }
  if (quantity < -TOLERANCE || quantity > layer.original_quantity + TOLERANCE) {
    throw new Error(`FIFO layer ${layer.id} has an invalid historical quantity.`);
  }
  return roundedQty(Math.max(0, quantity));
}

export function buildHistoricalValuation(input: {
  variants: HistoricalVariant[];
  stock: HistoricalStock[];
  movements: HistoricalMovement[];
  layers: HistoricalLayer[];
  epochs: HistoricalEpoch[];
  cutoff: string;
}) {
  const cutoff = timestamp(input.cutoff);
  const epoch = [...input.epochs].filter(e => timestamp(e.started_at) < cutoff)
    .sort((a, b) => timestamp(b.started_at).localeCompare(timestamp(a.started_at)) || b.id - a.id)[0];
  const method = epoch?.method ?? 'average_cost';
  const warnings: ValuationWarnings = {
    current_cost_sku_count: 0, uncosted_sku_count: 0, inferred_opening_sku_count: 0,
    incomplete_history_sku_count: 0, negative_position_count: 0,
  };
  const mismatches: ValuationReconciliation['mismatches'] = [];
  const rows: ValuationRow[] = [];
  const movementsByVariant = new Map<string, HistoricalMovement[]>();
  const stockByVariant = new Map<string, HistoricalStock[]>();
  const layersByVariant = new Map<string, HistoricalLayer[]>();
  for (const m of input.movements) {
    const group = movementsByVariant.get(m.variant_id) ?? [];
    group.push(m);
    movementsByVariant.set(m.variant_id, group);
  }
  for (const s of input.stock) {
    const group = stockByVariant.get(s.variant_id) ?? [];
    group.push(s);
    stockByVariant.set(s.variant_id, group);
  }
  for (const layer of input.layers) {
    const group = layersByVariant.get(layer.variant_id) ?? [];
    group.push(layer);
    layersByVariant.set(layer.variant_id, group);
  }
  for (const variant of input.variants) {
    const moves = (movementsByVariant.get(variant.variant_id) ?? [])
      .sort((a, b) => timestamp(a.created_at).localeCompare(timestamp(b.created_at)) || a.id - b.id);
    const earliest = moves[0]?.created_at;
    if (timestamp(variant.created_at) >= cutoff && (!earliest || timestamp(earliest) >= cutoff)) continue;
    const current = new Map((stockByVariant.get(variant.variant_id) ?? []).map(s => [s.location_id, s.qty_on_hand]));
    const positions = new Map<number, number>();
    const deltas = new Map<number, number>();
    let inferred = false;
    let incomplete = false;
    for (const m of moves) {
      deltas.set(m.location_id, (deltas.get(m.location_id) ?? 0) + physicalMovementDelta(m));
      if (!positions.has(m.location_id)) {
        const opening = roundedQty(m.qty_after_soh - physicalMovementDelta(m));
        positions.set(m.location_id, opening);
        if (Math.abs(opening) > TOLERANCE) inferred = true;
      }
    }
    for (const [location, quantity] of current) {
      if (!positions.has(location)) {
        positions.set(location, quantity);
        if (Math.abs(quantity) > TOLERANCE) inferred = true;
      }
    }
    let averageCost: number | null = null;
    let costEpoch: number | null = null;
    for (const m of moves) {
      if (timestamp(m.created_at) >= cutoff) break;
      const delta = physicalMovementDelta(m);
      if (delta !== 0 && m.cost_epoch_id !== costEpoch) {
        averageCost = null;
        costEpoch = m.cost_epoch_id;
      }
      const before = positions.get(m.location_id) ?? 0;
      const quantityBefore = [...positions.values()].reduce((sum, q) => sum + q, 0);
      if (Math.abs(before + delta - m.qty_after_soh) > TOLERANCE) {
        incomplete = true;
        averageCost = null;
      }
      if (m.cost_method_snapshot === 'average_cost' && !m.cost_repaired) {
        if (m.average_cost_after != null) averageCost = m.average_cost_after;
        else if ((m.movement_type === 'pos_sale' || m.movement_type === 'so_fulfilled'
          || m.movement_type === 'transfer_out' || m.movement_type === 'transfer_in'
          || m.movement_type === 'stocktake'
          || m.movement_type === 'build_component_consumed')
          && m.unit_cost != null) averageCost = m.unit_cost;
        else if ((m.movement_type === 'po_received' || m.movement_type === 'build_component_restored') && delta > 0) {
          averageCost = m.unit_cost == null || (averageCost == null && quantityBefore > TOLERANCE)
            ? null : roundedCost(computeWeightedAverageCost({
              oldQtyOnHand: quantityBefore, oldAvgCost: averageCost ?? 0,
              receivedQty: delta, receivedUnitCostAud: m.unit_cost,
            }));
        } else if (m.movement_type === 'po_unapproved' && delta < 0) {
          averageCost = averageCost == null || m.unit_cost == null || -delta > quantityBefore + TOLERANCE
            ? null : roundedCost(computeAverageCostAfterReversal({
              currentQtyOnHand: quantityBefore, currentAvgCost: averageCost,
              reversedQty: -delta, reversedUnitCostAud: m.unit_cost,
            }));
        } else if (m.movement_type === 'build_output_produced' || m.movement_type === 'build_output_reversed') {
          averageCost = null;
        }
      } else if (delta !== 0 && m.cost_repaired) averageCost = null;
      positions.set(m.location_id, m.qty_after_soh);
    }
    if (method === 'average_cost' && costEpoch !== (epoch?.id ?? null)) averageCost = null;
    // Compare the complete recorded ledger with live stock to expose unrecorded overwrites.
    for (const [location, totalDelta] of deltas) {
      const first = moves.find(m => m.location_id === location)!;
      const expected = first.qty_after_soh - physicalMovementDelta(first) + totalDelta;
      if (Math.abs(expected - (current.get(location) ?? 0)) > TOLERANCE) incomplete = true;
    }
    const soh = roundedQty([...positions.values()].reduce((sum, q) => sum + q, 0));
    let layerQuantity = 0;
    let layerValue = 0;
    const layerPositions = new Map<number, number>();
    if (method === 'fifo') {
      for (const layer of layersByVariant.get(variant.variant_id) ?? []) {
        const quantity = reconstructLayer(layer, cutoff);
        layerQuantity += quantity;
        layerValue += quantity * layer.unit_cost;
        layerPositions.set(layer.location_id, (layerPositions.get(layer.location_id) ?? 0) + quantity);
      }
      for (const location of new Set([...positions.keys(), ...layerPositions.keys()])) {
        const stockQty = positions.get(location) ?? 0;
        const layerQty = roundedQty(layerPositions.get(location) ?? 0);
        if (Math.abs(stockQty - layerQty) > TOLERANCE) {
          mismatches.push({
            variant_id: variant.variant_id, location_id: location, stock_quantity: stockQty,
            layer_quantity: layerQty, reconciliation_delta: roundedQty(stockQty - layerQty),
          });
        }
      }
    }
    warnings.negative_position_count += [...positions.values()].filter(q => q < -TOLERANCE).length;
    if (incomplete) warnings.incomplete_history_sku_count++;
    if (soh <= 0 && layerQuantity <= 0) continue;
    if (inferred) warnings.inferred_opening_sku_count++;
    let costSource: ValuationCostSource = 'historical';
    let cost: number;
    let totalValue: number;
    const fifoBalanced = !mismatches.some(m => m.variant_id === variant.variant_id);
    if (method === 'fifo' && layerQuantity > 0 && fifoBalanced) {
      cost = layerValue / layerQuantity;
      totalValue = layerValue;
    } else {
      const historicalCost = method === 'average_cost' ? averageCost : null;
      cost = historicalCost ?? variant.current_cost ?? 0;
      costSource = historicalCost != null ? 'historical'
        : variant.current_cost != null ? 'current_fallback' : 'uncosted';
      totalValue = soh * cost;
    }
    if (costSource === 'current_fallback') warnings.current_cost_sku_count++;
    if (costSource === 'uncosted') warnings.uncosted_sku_count++;
    rows.push({
      variant_id: variant.variant_id, sku: variant.sku, name: variant.name, brand: variant.brand,
      supplier_name: variant.supplier_name, cost, soh, total_value: totalValue,
      layer_quantity: method === 'fifo' ? roundedQty(layerQuantity) : null,
      reconciliation_delta: method === 'fifo' ? roundedQty(soh - layerQuantity) : 0,
      cost_source: costSource, inferred_opening: inferred,
    });
  }
  return {
    data: rows, costing_method: method, cost_epoch_id: epoch?.id ?? null, warnings,
    reconciliation: {
      status: mismatches.length ? 'mismatch' : 'balanced',
      mismatched_sku_count: new Set(mismatches.map(m => m.variant_id)).size,
      mismatched_location_count: mismatches.length,
      stock_quantity: rows.reduce((sum, row) => sum + row.soh, 0),
      valued_quantity: rows.reduce((sum, row) => sum + (row.layer_quantity ?? row.soh), 0),
      mismatches,
    } satisfies ValuationReconciliation,
  };
}
