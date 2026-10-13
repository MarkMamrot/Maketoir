import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { PreparedShippingRequest } from "./shippingDrafts";
import { getIMSPool } from "@/services/IMSMySQLService";
import {
  getShippingBatchId, shippingBatchMembershipIssue, ShippingBatchError,
  validateShippingBatchMembershipInput,
  type ShippingBatchMembershipInput, type ShippingBatchMembershipResult,
} from "./shippingBatchTypes";
import { supersedeShippingBatchLabels } from "./shippingLabelRevisions";

type BatchShipment = RowDataPacket & {
  id: number;
  so_id: number;
  operation_key: string;
  revision: number;
  status: string;
  manifest_id: number | null;
  ims_fulfilled_at: string | Date | null;
  membership_id: number | null;
  batch_key: string | null;
  batch_revision: number | null;
  parcel_count: number;
  invalid_parcel_count: number;
  carrier_account_id: number | null;
  provider_shipment_id: string | null;
};
type BatchLabel = RowDataPacket & {
  id: number;
  shipment_id: number;
  provider_request_id: string | null;
  label_url: string | null;
};

// Lock shipment identities first, including missing membership rows. This serializes
// legacy-to-explicit membership changes and destination disappearance without backfill.
export async function lockShippingBatchShipments(connection: PoolConnection, businessId: string) {
  const [rows] = await connection.execute<BatchShipment[]>(
    `SELECT shipment.id, shipment.so_id, shipment.operation_key, shipment.revision, shipment.status,
            shipment.manifest_id, shipment.ims_fulfilled_at, shipment.carrier_account_id, shipment.provider_shipment_id,
            membership.shipment_id AS membership_id, membership.batch_key,
            membership.revision AS batch_revision
            , (SELECT COUNT(*) FROM ims_shipping_parcels parcel
                 WHERE parcel.business_id = shipment.business_id AND parcel.shipment_id = shipment.id) AS parcel_count
            , (SELECT COUNT(*) FROM ims_shipping_parcels parcel
                 WHERE parcel.business_id = shipment.business_id AND parcel.shipment_id = shipment.id
                   AND (COALESCE(parcel.length_mm, 0) <= 0 OR COALESCE(parcel.width_mm, 0) <= 0
                     OR COALESCE(parcel.height_mm, 0) <= 0 OR COALESCE(parcel.weight_kg, 0) <= 0)) AS invalid_parcel_count
       FROM ims_shipping_shipments shipment
       LEFT JOIN ims_shipping_batch_memberships membership
         ON membership.business_id = shipment.business_id AND membership.shipment_id = shipment.id
      WHERE shipment.business_id = ? ORDER BY shipment.id FOR UPDATE`,
    [businessId],
  );
  return rows;
}

function batchId(shipment: BatchShipment) {
  return getShippingBatchId(shipment.operation_key,
    shipment.membership_id == null ? null : { batch_key: shipment.batch_key });
}

export async function changeShippingBatchMembership(
  businessId: string, input: ShippingBatchMembershipInput,
): Promise<ShippingBatchMembershipResult> {
  validateShippingBatchMembershipInput(input);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const shipments = await lockShippingBatchShipments(connection, businessId);
    const byId = new Map(shipments.map((shipment) => [Number(shipment.id), shipment]));
    if (input.batchId !== null) {
      const exists = shipments.some((shipment) => batchId(shipment) === input.batchId &&
        !["voided", "manifested"].includes(shipment.status) && shipment.manifest_id == null);
      if (!exists && !input.createBatch)
        throw new ShippingBatchError("The destination batch no longer exists. Refresh the workspace.", 404);
      if (exists && input.createBatch)
        throw new ShippingBatchError("That batch already exists. Refresh the workspace.", 409);
    }
    const changed: BatchShipment[] = [];
    for (const expected of [...input.shipmentIds].sort((a, b) => a.shipmentId - b.shipmentId)) {
      const shipment = byId.get(expected.shipmentId);
      if (!shipment) throw new ShippingBatchError("Shipment not found.", 404);
      if (Number(shipment.batch_revision ?? 0) !== expected.expectedBatchRevision ||
          Number(shipment.revision) !== expected.expectedShipmentRevision)
        throw new ShippingBatchError("Shipment or batch changed. Refresh the workspace before trying again.", 409);
      const issue = shippingBatchMembershipIssue({
        status: shipment.status, manifestId: shipment.manifest_id, imsFulfilledAt: shipment.ims_fulfilled_at,
      });
      if (issue) throw new ShippingBatchError(issue, 409);
      if (input.batchId !== null && (!(Number(shipment.parcel_count) > 0) || Number(shipment.invalid_parcel_count) !== 0))
        throw new ShippingBatchError("Save valid parcel dimensions and packed weight before adding orders to a batch.", 409);
      if (input.batchId !== null && shipment.carrier_account_id == null && input.carrierAccountId === undefined)
        throw new ShippingBatchError("Choose a carrier account before adding prepared orders to a batch.", 400);
      if (input.carrierAccountId !== undefined && shipment.provider_shipment_id &&
          Number(shipment.carrier_account_id) !== input.carrierAccountId)
        throw new ShippingBatchError("Booked shipments retain their carrier account. Move them without changing the carrier.", 409);
      if (batchId(shipment) !== input.batchId) changed.push(shipment);
    }
    const carrierUpdates: Array<{ shipment: BatchShipment; revision: number; carrierAccountId: number; prepared: PreparedShippingRequest }> = [];
    if (input.carrierAccountId !== undefined) {
      const [accounts] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM ims_shipping_carrier_accounts WHERE business_id = ? AND id = ? AND is_active = 1",
        [businessId, input.carrierAccountId],
      );
      if (!accounts.length) throw new ShippingBatchError("Active carrier account not found. Refresh and choose an available account.", 400);
      const { getShippingEditableDetail } = await import("./shippingAmendments");
      const { prepareShippingRequest } = await import("./shippingDrafts");
      for (const expected of input.shipmentIds) {
        const shipment = byId.get(expected.shipmentId)!;
        if (shipment.provider_shipment_id) continue;
        const detail = await getShippingEditableDetail(businessId, expected.shipmentId);
        const prepared = await prepareShippingRequest({
            businessId, carrierAccountId: input.carrierAccountId,
            shipments: [{
              soId: detail.soId, recipient: detail.recipient, parcels: detail.parcels,
              exportPurpose: detail.customs?.exportPurpose,
              nonSaleValues: detail.customs?.parcels.flatMap(parcel => parcel.items.map(item => ({ soItemId: item.soItemId, unitValue: item.unitValue }))),
              nonSaleValuesConfirmed: detail.customs?.nonSaleValuesConfirmed,
            }],
          });
        carrierUpdates.push({ shipment, revision: expected.expectedShipmentRevision, carrierAccountId: input.carrierAccountId, prepared });
      }
    }
    const changedIds = new Set(changed.map((shipment) => Number(shipment.id)));
    const carrierUpdateIds = new Set(carrierUpdates.map(update => Number(update.shipment.id)));
    const [labels] = await connection.execute<BatchLabel[]>(
      `SELECT label.id, label.shipment_id, label.provider_request_id, label.label_url
         FROM ims_shipping_labels label
         JOIN ims_shipping_shipments shipment
           ON shipment.business_id = label.business_id AND shipment.id = label.shipment_id
        WHERE label.business_id = ? AND label.status <> 'superseded'
          AND label.shipment_revision = shipment.revision
        ORDER BY label.id FOR UPDATE`, [businessId],
    );
    const unsafeLabels = new Set<number>();
    const refreshIds = new Set<number>();
    const visited = new Set<number>();
    for (const source of labels.filter((label) => changedIds.has(Number(label.shipment_id)) || carrierUpdateIds.has(Number(label.shipment_id)))) {
      if (visited.has(Number(source.id))) continue;
      const shared = [source];
      visited.add(Number(source.id));
      for (let index = 0; index < shared.length; index++) {
        const current = shared[index];
        for (const label of labels) {
          if (!visited.has(Number(label.id)) &&
              ((current.provider_request_id != null && current.provider_request_id === label.provider_request_id) ||
               (current.label_url != null && current.label_url === label.label_url))) {
            shared.push(label);
            visited.add(Number(label.id));
          }
        }
      }
      const groups = new Set(shared.map((label) => {
        const shipment = byId.get(Number(label.shipment_id))!;
        const destination = changedIds.has(Number(shipment.id)) ? input.batchId : batchId(shipment);
        return destination === null ? `unbatched:${shipment.id}` : `batch:${destination}`;
      }));
      if (groups.size <= 1 && !shared.some(label => carrierUpdateIds.has(Number(label.shipment_id)))) continue;
      for (const label of shared) {
        const shipment = byId.get(Number(label.shipment_id))!;
        const issue = shippingBatchMembershipIssue({
          status: shipment.status, manifestId: shipment.manifest_id, imsFulfilledAt: shipment.ims_fulfilled_at,
        });
        if (issue) throw new ShippingBatchError(`A shared label PDF cannot be refreshed. ${issue}`, 409);
        unsafeLabels.add(Number(label.id));
        refreshIds.add(Number(shipment.id));
      }
    }
    if (unsafeLabels.size)
      await supersedeShippingBatchLabels(connection, businessId, [...unsafeLabels], [...refreshIds]);
    for (const update of carrierUpdates) {
      const entry = update.prepared.entries[0];
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE ims_shipping_shipments SET carrier_account_id = ?, provider = ?, dispatch_location_id = ?,
           status = 'draft', safe_error = NULL,
           sender_json = ?, service_code = NULL, service_name = NULL, quoted_cost = NULL,
           quoted_cost_ex_gst = NULL, quoted_gst = NULL, revision = revision + 1, updated_at = NOW()
         WHERE business_id = ? AND id = ? AND revision = ? AND provider_shipment_id IS NULL`,
        [update.carrierAccountId, update.prepared.account.provider, entry.dispatchLocationId,
          JSON.stringify(entry.sender), businessId, update.shipment.id, update.revision],
      );
      if (result.affectedRows !== 1) throw new ShippingBatchError("Shipment changed. Refresh before choosing its carrier.", 409);
    }
    for (const shipment of changed) {
      await connection.execute(
        `INSERT INTO ims_shipping_batch_memberships (business_id, shipment_id, batch_key, revision)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE batch_key = VALUES(batch_key), revision = revision + 1`,
        [businessId, shipment.id, input.batchId],
      );
    }
    await connection.commit();
    return {
      affectedShipmentIds: [...new Set([...input.shipmentIds.map((entry) => entry.shipmentId), ...refreshIds])].sort((a, b) => a - b),
      requiresFreshLabels: unsafeLabels.size > 0,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
