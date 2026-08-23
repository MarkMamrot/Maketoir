export const ONLINE_SHOP_FULFILMENT_MODES = ['single_location', 'consolidate', 'split'] as const;
export type OnlineShopFulfilmentMode = typeof ONLINE_SHOP_FULFILMENT_MODES[number];

export interface OnlineShopAllocationLine {
  variantId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OnlineShopLocationStock {
  locationId: number;
  priority: number;
  availableByVariant: Readonly<Record<string, number>>;
}

export interface OnlineShopStockReservationPlan {
  variantId: string;
  locationId: number;
  quantity: number;
}

export interface OnlineShopFulfilmentGroupPlan {
  locationId: number;
  reservations: OnlineShopStockReservationPlan[];
}

export interface OnlineShopAllocationPlan {
  dispatchLocationId: number;
  reservations: OnlineShopStockReservationPlan[];
  fulfilmentGroups: OnlineShopFulfilmentGroupPlan[];
  subtotalCents: number;
  taxCents: number;
}

export class OnlineShopStockConflict extends Error {}

function wholePositive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive whole number.`);
  return value;
}

function orderedLocations(locations: readonly OnlineShopLocationStock[]): OnlineShopLocationStock[] {
  const ids = new Set<number>();
  return [...locations].map(location => {
    wholePositive(location.locationId, 'Location ID');
    if (ids.has(location.locationId)) throw new Error('Each location may only appear once.');
    ids.add(location.locationId);
    return location;
  }).sort((left, right) => left.priority - right.priority || left.locationId - right.locationId);
}

function lineTotals(lines: readonly OnlineShopAllocationLine[]): { subtotalCents: number; taxCents: number } {
  let subtotalCents = 0;
  let taxCents = 0;
  for (const line of lines) {
    const quantity = wholePositive(line.quantity, 'Quantity');
    const unitPriceCents = wholePositive(line.unitPriceCents, 'Unit price');
    const lineTotalCents = quantity * unitPriceCents;
    if (!Number.isSafeInteger(lineTotalCents)) throw new Error('Cart total is too large.');
    subtotalCents += lineTotalCents;
    taxCents += Math.round(lineTotalCents - lineTotalCents / 1.1);
  }
  if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(taxCents)) throw new Error('Cart total is too large.');
  return { subtotalCents, taxCents };
}

function groupReservations(reservations: readonly OnlineShopStockReservationPlan[]): OnlineShopFulfilmentGroupPlan[] {
  const groups = new Map<number, OnlineShopStockReservationPlan[]>();
  for (const reservation of reservations) {
    const group = groups.get(reservation.locationId) ?? [];
    group.push(reservation);
    groups.set(reservation.locationId, group);
  }
  return [...groups].map(([locationId, group]) => ({ locationId, reservations: group }));
}

export function allocateOnlineShopCart(input: {
  mode: OnlineShopFulfilmentMode;
  lines: readonly OnlineShopAllocationLine[];
  locations: readonly OnlineShopLocationStock[];
  dispatchLocationId?: number | null;
}): OnlineShopAllocationPlan {
  if (!ONLINE_SHOP_FULFILMENT_MODES.includes(input.mode)) throw new Error('Invalid online shop fulfilment mode.');
  if (!input.lines.length) throw new Error('Cart must contain at least one line.');
  const variantIds = new Set<string>();
  for (const line of input.lines) {
    if (!line.variantId.trim() || variantIds.has(line.variantId)) throw new Error('Cart variant IDs must be unique and non-empty.');
    variantIds.add(line.variantId);
  }
  const locations = orderedLocations(input.locations);
  if (!locations.length) throw new OnlineShopStockConflict('No online fulfilment locations are available.');
  const totals = lineTotals(input.lines);

  if (input.mode === 'single_location') {
    const location = locations.find(candidate => input.lines.every(line =>
      Math.floor(Number(candidate.availableByVariant[line.variantId]) || 0) >= line.quantity));
    if (!location) throw new OnlineShopStockConflict('No single location can fulfil the whole cart.');
    const reservations = input.lines.map(line => ({ variantId: line.variantId, locationId: location.locationId, quantity: line.quantity }));
    return { dispatchLocationId: location.locationId, reservations, fulfilmentGroups: [{ locationId: location.locationId, reservations }], ...totals };
  }

  const reservations: OnlineShopStockReservationPlan[] = [];
  for (const line of input.lines) {
    let remaining = line.quantity;
    for (const location of locations) {
      const available = Math.max(0, Math.floor(Number(location.availableByVariant[line.variantId]) || 0));
      const quantity = Math.min(available, remaining);
      if (quantity > 0) reservations.push({ variantId: line.variantId, locationId: location.locationId, quantity });
      remaining -= quantity;
      if (remaining === 0) break;
    }
    if (remaining > 0) throw new OnlineShopStockConflict(`Insufficient stock for variant ${line.variantId}.`);
  }

  const groups = groupReservations(reservations);
  if (input.mode === 'split') {
    return { dispatchLocationId: groups[0].locationId, reservations, fulfilmentGroups: groups, ...totals };
  }
  const dispatchLocationId = wholePositive(Number(input.dispatchLocationId), 'Dispatch location ID');
  if (!locations.some(location => location.locationId === dispatchLocationId)) {
    throw new Error('The dispatch location must be an active online location.');
  }
  return { dispatchLocationId, reservations, fulfilmentGroups: [{ locationId: dispatchLocationId, reservations }], ...totals };
}