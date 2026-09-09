import type {
  ShippingOrderEligibility,
  ShippingOrderEligibilityInput,
  ShippingOrderLine,
  ShippingParcelDraft,
  ShippingShipmentStatus,
} from './types';

const QUANTITY_SCALE = 10_000;

const SHIPMENT_TRANSITIONS: Record<ShippingShipmentStatus, readonly ShippingShipmentStatus[]> = {
  draft: ['quoting', 'failed'],
  quoting: ['draft', 'submitting', 'failed'],
  submitting: ['carrier_created', 'failed'],
  carrier_created: ['label_pending', 'label_ready', 'failed', 'voided'],
  label_pending: ['label_ready', 'failed', 'voided'],
  label_ready: ['ims_fulfilled', 'failed', 'voided'],
  ims_fulfilled: ['channel_pending', 'complete'],
  channel_pending: ['complete', 'failed'],
  complete: ['manifested'],
  failed: ['draft', 'quoting', 'submitting', 'label_pending', 'channel_pending', 'voided'],
  voided: [],
  manifested: [],
};

export function getShippingOrderEligibility(input: ShippingOrderEligibilityInput): ShippingOrderEligibility {
  if (input.isPosLedger) return { eligible: false, reason: 'POS sales cannot be shipped from Sales Orders.' };
  if (input.status === 'draft') return { eligible: false, reason: 'Confirm this order before shipping.' };
  if (input.status === 'cancelled') return { eligible: false, reason: 'Cancelled orders cannot be shipped.' };
  if (input.status === 'fulfilled') return { eligible: false, reason: 'This order is already fulfilled.' };
  if (input.status !== 'confirmed' && input.status !== 'partially_fulfilled') {
    return { eligible: false, reason: 'This order is not ready to ship.' };
  }
  if (input.remainingQuantity <= 0) return { eligible: false, reason: 'This order has no remaining quantity.' };
  if (input.soType !== 'online' && input.soType !== 'b2b') {
    return { eligible: false, reason: 'Only online and wholesale orders can be shipped.' };
  }
  return { eligible: true };
}

export function canTransitionShippingShipment(
  from: ShippingShipmentStatus,
  to: ShippingShipmentStatus,
): boolean {
  return from === to || SHIPMENT_TRANSITIONS[from].includes(to);
}

export function validateShippingParcels(
  lines: ShippingOrderLine[],
  parcels: ShippingParcelDraft[],
): string[] {
  const errors: string[] = [];
  const remainingByItem = new Map(lines.map(line => [line.soItemId, toScaledQuantity(line.remainingQuantity)]));
  const allocatedByItem = new Map<number, number>();
  const parcelNumbers = new Set<number>();

  if (parcels.length === 0) errors.push('Add at least one parcel.');

  for (const parcel of parcels) {
    if (!Number.isInteger(parcel.parcelNumber) || parcel.parcelNumber < 1 || parcelNumbers.has(parcel.parcelNumber)) {
      errors.push('Parcel numbers must be unique positive integers.');
    }
    parcelNumbers.add(parcel.parcelNumber);
    if (![parcel.lengthMm, parcel.widthMm, parcel.heightMm, parcel.weightKg].every(value => Number.isFinite(value) && value > 0)) {
      errors.push(`Parcel ${parcel.parcelNumber} requires positive dimensions and weight.`);
    }
    if (parcel.allocations.length === 0) errors.push(`Parcel ${parcel.parcelNumber} has no order lines assigned.`);

    for (const allocation of parcel.allocations) {
      const quantity = toScaledQuantity(allocation.quantity);
      if (!remainingByItem.has(allocation.soItemId)) {
        errors.push(`Parcel ${parcel.parcelNumber} contains an unknown order line.`);
      } else if (quantity <= 0) {
        errors.push(`Parcel ${parcel.parcelNumber} quantities must be greater than zero.`);
      } else {
        allocatedByItem.set(allocation.soItemId, (allocatedByItem.get(allocation.soItemId) ?? 0) + quantity);
      }
    }
  }

  for (const [soItemId, remaining] of remainingByItem) {
    const allocated = allocatedByItem.get(soItemId) ?? 0;
    if (allocated > remaining) {
      errors.push(`Allocated quantity exceeds the remaining quantity for order line ${soItemId}.`);
    } else if (allocated < remaining) {
      errors.push(`Assign the full remaining quantity for order line ${soItemId} to a parcel.`);
    }
  }

  return [...new Set(errors)];
}

export function getAusPostLabelBatchLimit(format: 'PDF' | 'ZPL', waitForLabelUrl: boolean): number | null {
  if (format === 'ZPL') return 50;
  return waitForLabelUrl ? 250 : null;
}

export function splitAusPostLabelBatch<T>(
  items: readonly T[],
  format: 'PDF' | 'ZPL',
  waitForLabelUrl: boolean,
): T[][] {
  const limit = getAusPostLabelBatchLimit(format, waitForLabelUrl);
  if (limit === null || items.length === 0) return items.length === 0 ? [] : [[...items]];
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += limit) batches.push(items.slice(index, index + limit));
  return batches;
}

function toScaledQuantity(value: number): number {
  return Number.isFinite(value) ? Math.round(value * QUANTITY_SCALE) : 0;
}