import type { RowDataPacket } from 'mysql2/promise';
import { getIMSPool } from '@/services/IMSMySQLService';
import { amendShippingShipment, getShippingEditableDetail } from './shippingAmendments';
import { ShippingAmendmentError } from './shippingAmendmentPolicy';
import { createShippingDrafts, type ShippingRequestInput } from './shippingDrafts';
import type { ShippingEditableDetail } from './shippingAmendmentTypes';

export type ShippingOrderPreparation = {
  shipment: ShippingEditableDetail;
};
export type SaveShippingOrderPreparation = ShippingRequestInput['shipments'][number] & {
  operationKey: string;
  carrierAccountId: number;
  expectedRevision?: number;
  expectedUpdatedAt?: string;
};

async function findOrderShipment(businessId: string, soId: number) {
  if (!Number.isSafeInteger(soId) || soId <= 0)
    throw new ShippingAmendmentError('A valid sales order ID is required.');
  const connection = await getIMSPool().getConnection();
  try {
    const [rows] = await connection.execute<(RowDataPacket & {
      id: number; operation_key: string; provider_shipment_id: string | null;
      membership_id: number | null; batch_key: string | null;
    })[]>(
      `SELECT shipment.id, shipment.operation_key, shipment.provider_shipment_id,
              membership.shipment_id AS membership_id, membership.batch_key
         FROM ims_shipping_shipments shipment
         LEFT JOIN ims_shipping_batch_memberships membership
           ON membership.business_id = shipment.business_id AND membership.shipment_id = shipment.id
        WHERE shipment.business_id = ? AND shipment.so_id = ?
          AND shipment.status <> 'voided' AND shipment.ims_fulfilled_at IS NULL
        ORDER BY shipment.id DESC LIMIT 1`,
      [businessId, soId],
    );
    const row = rows[0];
    if (row && (row.provider_shipment_id || row.membership_id == null || row.batch_key !== null))
      throw new ShippingAmendmentError('This order already belongs to a batch or has postage. Open its existing shipment.', 409);
    return row ?? null;
  } finally {
    connection.release();
  }
}

export async function getShippingOrderPreparation(businessId: string, soId: number): Promise<ShippingOrderPreparation | null> {
  const row = await findOrderShipment(businessId, soId);
  if (!row) return null;
  return { shipment: await getShippingEditableDetail(businessId, Number(row.id)) };
}

export async function saveShippingOrderPreparation(
  businessId: string, soId: number, input: SaveShippingOrderPreparation,
): Promise<ShippingOrderPreparation> {
  if (!input || typeof input.operationKey !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(input.operationKey))
    throw new ShippingAmendmentError('A valid preparation operation key is required.');
  if (!Array.isArray(input.parcels) || !input.parcels.length || input.parcels.length > 50)
    throw new ShippingAmendmentError('Choose between 1 and 50 measured parcels.');
  const existing = await findOrderShipment(businessId, soId);
  if (!existing || (input.expectedRevision === undefined && existing.operation_key === `${input.operationKey}:${soId}`)) {
    if (!existing && input.expectedRevision !== undefined)
      throw new ShippingAmendmentError('The saved preparation changed. Refresh the order before saving.', 409);
    const [created] = await createShippingDrafts({
      businessId, operationKey: input.operationKey, carrierAccountId: input.carrierAccountId,
      preparationOnly: true, batchId: null,
      shipments: [{
        soId, parcels: input.parcels, exportPurpose: input.exportPurpose,
        nonSaleValues: input.nonSaleValues, nonSaleValuesConfirmed: input.nonSaleValuesConfirmed,
      }],
    });
    return { shipment: await getShippingEditableDetail(businessId, created.shipmentId) };
  }
  if (typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || !input.expectedUpdatedAt)
    throw new ShippingAmendmentError('Another staff member saved this order. Reload its dimensions before saving.', 409);
  const detail = await getShippingEditableDetail(businessId, Number(existing.id));
  const result = await amendShippingShipment(businessId, Number(existing.id), {
    ...input,
    operationKey: input.operationKey,
    expectedRevision: input.expectedRevision,
    expectedUpdatedAt: input.expectedUpdatedAt,
    recipient: detail.recipient,
    parcels: input.parcels.map(parcel => ({ ...parcel, packageType: parcel.packageType || 'box' })),
    service: null, preparationOnly: true,
  });
  return { shipment: result.shipment };
}
