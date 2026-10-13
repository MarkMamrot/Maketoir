export type ShippingBatchMembershipInput = {
  shipmentIds: Array<{
    shipmentId: number;
    expectedBatchRevision: number;
    expectedShipmentRevision: number;
  }>;
  batchId: string | null;
  createBatch?: boolean;
  carrierAccountId?: number;
};

export type ShippingBatchMembershipResult = {
  affectedShipmentIds: number[];
  requiresFreshLabels: boolean;
};

export class ShippingBatchError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "ShippingBatchError";
  }
}

export function getShippingBatchId(
  operationKey: string,
  membership?: { batch_key: string | null } | null,
): string | null {
  return membership ? membership.batch_key : operationKey.replace(/:\d+$/, "");
}

export function shippingBatchMembershipIssue(shipment: {
  status: string;
  manifestId?: number | null;
  imsFulfilledAt?: string | Date | null;
}): string {
  if (shipment.manifestId != null || shipment.imsFulfilledAt != null)
    return "Dispatched or manifested shipments cannot change batch.";
  if (!["draft", "quoting", "failed", "carrier_created", "label_ready"].includes(shipment.status))
    return "This shipment is in progress, voided, or requires reconciliation before changing batch.";
  return "";
}

export function validateShippingBatchId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 150)
    throw new ShippingBatchError("Choose a valid batch.", 400);
}

export function validateShippingBatchMembershipInput(
  value: unknown,
): asserts value is ShippingBatchMembershipInput {
  if (!value || typeof value !== "object")
    throw new ShippingBatchError("Choose shipments and a destination batch.", 400);
  const input = value as ShippingBatchMembershipInput;
  if (input.batchId !== null) validateShippingBatchId(input.batchId);
  if (input.createBatch !== undefined && typeof input.createBatch !== "boolean")
    throw new ShippingBatchError("Invalid create batch option.", 400);
  if (input.createBatch && input.batchId === null)
    throw new ShippingBatchError("A new batch needs a batch key.", 400);
  if (input.carrierAccountId !== undefined &&
      (!Number.isSafeInteger(input.carrierAccountId) || input.carrierAccountId <= 0 || input.batchId === null))
    throw new ShippingBatchError("Choose a valid carrier account when adding orders to a batch.", 400);
  if (!Array.isArray(input.shipmentIds) || !input.shipmentIds.length || input.shipmentIds.length > 50)
    throw new ShippingBatchError("Choose between 1 and 50 shipments.", 400);
  const ids = new Set<number>();
  for (const entry of input.shipmentIds) {
    if (!entry || !Number.isSafeInteger(entry.shipmentId) || entry.shipmentId <= 0 ||
        !Number.isSafeInteger(entry.expectedBatchRevision) || entry.expectedBatchRevision < 0 ||
        !Number.isSafeInteger(entry.expectedShipmentRevision) || entry.expectedShipmentRevision < 0 ||
        ids.has(entry.shipmentId))
      throw new ShippingBatchError("Shipment IDs and expected revisions must be valid and unique.", 400);
    ids.add(entry.shipmentId);
  }
}
