import type { PoolConnection, RowDataPacket } from "mysql2/promise";
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
            shipment.manifest_id, shipment.ims_fulfilled_at,
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
      if (batchId(shipment) !== input.batchId) changed.push(shipment);
    }
    const changedIds = new Set(changed.map((shipment) => Number(shipment.id)));
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
    for (const source of labels.filter((label) => changedIds.has(Number(label.shipment_id)))) {
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
      if (groups.size <= 1) continue;
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
