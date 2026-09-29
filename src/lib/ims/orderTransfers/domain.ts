const QUANTITY_SCALE = 10_000;

export type OrderTransferQuantityInput = {
  orderedQuantity: number;
  processedQuantity: number;
  readyQuantity: number;
  allocatedIncomingQuantity: number;
};

export type OrderTransferQuantityRules = {
  outstanding: number;
  unavailableNow: number;
  readyNow: number;
  allocatedIncoming: number;
  unallocatedShortage: number;
};

export type OrderTransferKind = 'sales_order' | 'purchase_order';

export type OrderTransferDocument = {
  id: number;
  kind: OrderTransferKind;
  businessId: string;
  contactId: number | null;
  locationId: number;
  currencyCode: string;
  exchangeRate?: number | null;
  taxTreatment: string;
  taxCode?: string | null;
  paymentTerms?: string | null;
  priceTier?: string | null;
  status: string;
  hasPayments?: boolean;
  xeroDocumentId?: string | null;
  xeroDocumentStatus?: string | null;
  hasSubmittedShipment?: boolean;
  commerciallyEditable?: boolean;
};

const OPEN_STATUSES: Record<OrderTransferKind, ReadonlySet<string>> = {
  sales_order: new Set(['draft', 'confirmed', 'partially_fulfilled', 'backordered']),
  purchase_order: new Set(['draft', 'confirmed', 'partially_received', 'backordered']),
};

function normalizedText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function getOrderTransferConflicts(
  source: OrderTransferDocument,
  target: OrderTransferDocument,
): string[] {
  const conflicts: string[] = [];
  if (source.id === target.id) conflicts.push('Choose a different destination order.');
  if (source.kind !== target.kind) conflicts.push('Source and destination must be the same order type.');
  if (source.businessId !== target.businessId) conflicts.push('Source and destination belong to different businesses.');
  if (source.contactId == null || target.contactId == null || source.contactId !== target.contactId) {
    conflicts.push(source.kind === 'sales_order' ? 'Customer does not match.' : 'Supplier does not match.');
  }
  if (source.locationId !== target.locationId) conflicts.push('Location does not match.');
  if (source.currencyCode.trim().toUpperCase() !== target.currencyCode.trim().toUpperCase()) {
    conflicts.push('Currency does not match.');
  }
  if (Number(source.exchangeRate ?? 1) !== Number(target.exchangeRate ?? 1)) {
    conflicts.push('Exchange rate does not match.');
  }
  if (source.taxTreatment !== target.taxTreatment) conflicts.push('Tax treatment does not match.');
  if (normalizedText(source.taxCode) !== normalizedText(target.taxCode)) conflicts.push('Tax code does not match.');
  if (normalizedText(source.paymentTerms) !== normalizedText(target.paymentTerms)) {
    conflicts.push('Payment terms do not match.');
  }
  if (source.kind === 'sales_order' && normalizedText(source.priceTier) !== normalizedText(target.priceTier)) {
    conflicts.push('Price tier does not match.');
  }

  for (const [role, document] of [['Source', source], ['Destination', target]] as const) {
    if (!OPEN_STATUSES[document.kind].has(document.status)) {
      conflicts.push(`${role} order is not open.`);
    }
    if (document.hasPayments) conflicts.push(`${role} order has payments.`);
    if (document.xeroDocumentId && normalizedText(document.xeroDocumentStatus).toUpperCase() !== 'DRAFT') {
      conflicts.push(`${role} order has a non-Draft Xero document.`);
    }
    if (document.hasSubmittedShipment) conflicts.push(`${role} order has a submitted shipment.`);
    if (document.commerciallyEditable === false) conflicts.push(`${role} order is controlled by an external channel.`);
  }

  return conflicts;
}

function scaledQuantity(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return Math.round(value * QUANTITY_SCALE);
}

function quantity(value: number): number {
  return value / QUANTITY_SCALE;
}

export function calculateOrderTransferQuantityRules(
  input: OrderTransferQuantityInput,
): OrderTransferQuantityRules {
  const ordered = scaledQuantity(input.orderedQuantity, 'Ordered quantity');
  const processed = scaledQuantity(input.processedQuantity, 'Processed quantity');
  const ready = scaledQuantity(input.readyQuantity, 'Ready quantity');
  const allocatedIncoming = scaledQuantity(
    input.allocatedIncomingQuantity,
    'Allocated incoming quantity',
  );

  if (ordered < 0 || processed < 0 || ready < 0 || allocatedIncoming < 0) {
    throw new Error('Transfer quantities cannot be negative.');
  }
  if (processed > ordered) {
    throw new Error('Processed quantity cannot exceed ordered quantity.');
  }

  const outstanding = ordered - processed;
  const readyNow = Math.min(outstanding, ready);
  const unavailableNow = outstanding - readyNow;
  const protectedIncoming = Math.min(unavailableNow, allocatedIncoming);
  const unallocatedShortage = unavailableNow - protectedIncoming;

  return {
    outstanding: quantity(outstanding),
    unavailableNow: quantity(unavailableNow),
    readyNow: quantity(readyNow),
    allocatedIncoming: quantity(protectedIncoming),
    unallocatedShortage: quantity(unallocatedShortage),
  };
}