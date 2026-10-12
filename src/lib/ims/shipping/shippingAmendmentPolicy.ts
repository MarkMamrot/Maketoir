import { createHash } from 'node:crypto';
import { AusPostApiError } from './carriers/auspostEparcel/client';
import type { ShippingAmendmentInput, ShippingEditableDetail } from './shippingAmendmentTypes';

export class ShippingAmendmentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 400, readonly affectedShipmentIds: number[] = [], readonly requiresFreshLabels = false) {
    super(message);
    this.name = 'ShippingAmendmentError';
  }
}
export function carrierAmendmentsEnabled(international: boolean): boolean {
  const configured = process.env[international ? 'AUSPOST_INTERNATIONAL_AMENDMENTS_VERIFIED' : 'AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED'];
  return configured === 'true' || (!international && configured === undefined);
}
export function getShipmentEditEligibility(row: {
  status: string; provider_shipment_id: string | null; ims_fulfilled_at?: unknown;
  manifest_id?: unknown; ims_fulfilment_operation_key?: unknown; is_international?: unknown; provider?: string;
}): { eligible: boolean; reason?: string } {
  if (row.ims_fulfilled_at || row.manifest_id || row.ims_fulfilment_operation_key)
    return { eligible: false, reason: 'Dispatch or manifest booking has begun; shipment details cannot be edited.' };
  if (!row.provider_shipment_id && ['draft', 'quoting', 'failed'].includes(row.status))
    return { eligible: true };
  if (!row.provider_shipment_id || !['carrier_created', 'label_ready'].includes(row.status))
    return { eligible: false, reason: 'This shipment is in flight, uncertain, or no longer editable. Reconcile any unknown outcome first.' };
  if (row.provider !== 'auspost_eparcel')
    return { eligible: false, reason: 'This carrier does not support verified in-place amendments.' };
  if (!carrierAmendmentsEnabled(Boolean(Number(row.is_international))))
    return { eligible: false, reason: Number(row.is_international)
      ? 'International carrier-created editing is disabled until in-place amendments and fresh labels have been verified.'
      : 'Domestic carrier-created editing has been disabled in the shipping configuration.' };
  return { eligible: true };
}
export function validateAmendmentConcurrency(detail: Pick<ShippingEditableDetail, 'revision' | 'updatedAt'>, input: { expectedRevision: number; expectedUpdatedAt: string }): void {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || !input.expectedUpdatedAt ||
      !Number.isFinite(Date.parse(input.expectedUpdatedAt)))
    throw new ShippingAmendmentError('A valid saved revision and updated time are required.');
  if (detail.revision !== input.expectedRevision || Date.parse(detail.updatedAt) !== Date.parse(input.expectedUpdatedAt))
    throw new ShippingAmendmentError('Shipment details changed. Reload before editing.', 409);
}
export function validateAmendmentIdentity(detail: ShippingEditableDetail, input: Pick<ShippingAmendmentInput, 'carrierAccountId' | 'recipient' | 'parcels'>): void {
  if (!Array.isArray(input.parcels) || !input.parcels.length || input.parcels.length > 20 ||
      input.parcels.some(parcel => !parcel || typeof parcel !== 'object'))
    throw new ShippingAmendmentError('Choose between one and twenty parcels.');
  const existing = new Map(detail.parcels.map(parcel => [parcel.parcelId, parcel]));
  const ids = input.parcels.flatMap(parcel => parcel.parcelId == null ? [] : [parcel.parcelId]);
  if (new Set(ids).size !== ids.length || ids.some(id => !existing.has(id)))
    throw new ShippingAmendmentError('Parcel identity does not belong to this shipment.');
  for (const parcel of input.parcels) {
    if (!parcel || !Array.isArray(parcel.allocations) || !parcel.allocations.length ||
        new Set(parcel.allocations.map(item => item.soItemId)).size !== parcel.allocations.length ||
        parcel.allocations.some(item => !Number.isInteger(item.soItemId) || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
          Math.abs(item.quantity * 10000 - Math.round(item.quantity * 10000)) > 0.00001))
      throw new ShippingAmendmentError('Parcel allocations require unique order lines and valid quantities.');
    if (![parcel.lengthMm, parcel.widthMm, parcel.heightMm, parcel.weightKg].every(value => Number.isFinite(value) && value > 0) ||
        [parcel.lengthMm, parcel.widthMm, parcel.heightMm].some(value => value > 99999999.99) || parcel.weightKg > 9999.9999)
      throw new ShippingAmendmentError('Parcels require valid positive dimensions and weight.');
    if (typeof parcel.packageType !== 'string' || !parcel.packageType.trim() || parcel.packageType.length > 30)
      throw new ShippingAmendmentError('A valid package type is required.');
    if (parcel.packagePresetId != null && (!Number.isInteger(parcel.packagePresetId) || parcel.packagePresetId <= 0))
      throw new ShippingAmendmentError('A valid package preset is required.');
    if (parcel.providerItemId && parcel.providerItemId !== existing.get(parcel.parcelId)?.providerItemId)
      throw new ShippingAmendmentError('Provider item identities cannot be changed.');
  }
  if (!detail.providerShipmentId) return;
  if (input.carrierAccountId !== detail.carrierAccountId || input.parcels.length !== detail.parcels.length ||
      ids.length !== detail.parcels.length || (input.recipient.country !== 'AU') !== detail.isInternational)
    throw new ShippingAmendmentError('Carrier-created shipments retain their carrier account, parcel count and domestic/international category.');
  for (const parcel of input.parcels) {
    const saved = existing.get(parcel.parcelId);
    if (!saved?.providerItemId || parcel.providerItemId !== saved.providerItemId || parcel.parcelNumber !== saved.parcelNumber)
      throw new ShippingAmendmentError('Carrier-created parcels retain their existing item IDs and parcel numbers.');
  }
}
export function isDefinitiveAmendmentRejection(error: unknown): boolean {
  return error instanceof AusPostApiError && [400, 401, 403, 404, 422].includes(error.status);
}
export function amendmentRequestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(input)) ?? 'undefined').digest('hex');
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, item]) => item !== undefined).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
