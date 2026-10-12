import type { FieldPacket, QueryResult } from "mysql2/promise";

export type LabelRefreshShipment = {
  id: number;
  status: string;
  manifest_id: number | null;
  ims_fulfilled_at: string | Date | null;
};

export function shippingLabelRefreshIssue(
  shipments: readonly LabelRefreshShipment[],
): string {
  if (shipments.some((shipment) => shipment.manifest_id || shipment.ims_fulfilled_at))
    return "A shared label PDF includes a dispatched or manifested shipment. Its shipment details cannot be amended.";
  if (shipments.some((shipment) =>
    !["draft", "quoting", "failed", "carrier_created", "label_ready"].includes(shipment.status),
  ))
    return "A shared label request is in progress or requires reconciliation. Resolve it before editing shipment details.";
  return "";
}

export async function supersedeShippingLabels(
  connection: {
    execute: (sql: string, values: (string | number)[]) => Promise<[QueryResult, FieldPacket[]]>;
  },
  businessId: string,
  shipmentId: number,
): Promise<number[]> {
  const [rows]: [unknown, FieldPacket[]] = await connection.execute(
    `SELECT DISTINCT shipment.id, shipment.status, shipment.manifest_id, shipment.ims_fulfilled_at
       FROM ims_shipping_shipments shipment
       JOIN ims_shipping_labels label
         ON label.shipment_id = shipment.id AND label.business_id = shipment.business_id
      WHERE shipment.business_id = ? AND label.status <> 'superseded'
        AND (label.shipment_revision = shipment.revision OR shipment.id = ?)
        AND EXISTS (
          SELECT 1 FROM ims_shipping_labels source_label
           WHERE source_label.business_id = ? AND source_label.shipment_id = ?
             AND source_label.status <> 'superseded'
             AND ((source_label.provider_request_id IS NOT NULL AND source_label.provider_request_id = label.provider_request_id)
               OR (source_label.label_url IS NOT NULL AND source_label.label_url = label.label_url))
        )
      ORDER BY shipment.id FOR UPDATE`,
    [businessId, shipmentId, businessId, shipmentId],
  );
  if (!Array.isArray(rows) || !rows.every(isLabelRefreshShipment))
    throw new Error("Shared label shipment state could not be verified. Refresh the workspace before editing.");
  const members = rows;
  const issue = shippingLabelRefreshIssue(members);
  if (issue) throw new Error(issue);
  const affected = [...new Set([shipmentId, ...members.map((member) => Number(member.id))])];
  const placeholders = affected.map(() => "?").join(",");
  await connection.execute(
    `UPDATE ims_shipping_labels
        SET status = 'superseded', safe_error = 'Shipment details changed. Discard the old PDF and generate fresh labels.'
      WHERE business_id = ? AND shipment_id IN (${placeholders}) AND status <> 'superseded'`,
    [businessId, ...affected],
  );
  await connection.execute(
    `UPDATE ims_shipping_shipments
        SET revision = revision + 1, status = 'carrier_created', label_ready_at = NULL,
            safe_error = 'A shared label PDF changed. Generate fresh labels and discard old copies.'
      WHERE business_id = ? AND id IN (${placeholders}) AND id <> ?
        AND provider_shipment_id IS NOT NULL AND status IN ('label_ready', 'carrier_created', 'failed')
        AND manifest_id IS NULL AND ims_fulfilled_at IS NULL`,
    [businessId, ...affected, shipmentId],
  );
  return affected;
}

function isLabelRefreshShipment(value: unknown): value is LabelRefreshShipment {
  return Boolean(
    value && typeof value === "object" &&
    "id" in value && typeof value.id === "number" &&
    "status" in value && typeof value.status === "string" &&
    "manifest_id" in value && (value.manifest_id === null || typeof value.manifest_id === "number") &&
    "ims_fulfilled_at" in value &&
    (value.ims_fulfilled_at === null || typeof value.ims_fulfilled_at === "string" || value.ims_fulfilled_at instanceof Date),
  );
}

/** Caller holds all affected shipment/label locks and has checked shared-member eligibility. */
export async function supersedeShippingBatchLabels(
  connection: {
    execute: (sql: string, values: (string | number)[]) => Promise<[QueryResult, FieldPacket[]]>;
  },
  businessId: string,
  labelIds: number[],
  shipmentIds: number[],
): Promise<void> {
  if (!labelIds.length || !shipmentIds.length) return;
  await connection.execute(
    `UPDATE ims_shipping_labels
        SET status = 'superseded', safe_error = 'Batch membership changed. Discard old copies and generate fresh labels.'
      WHERE business_id = ? AND id IN (${labelIds.map(() => "?").join(",")}) AND status <> 'superseded'`,
    [businessId, ...labelIds],
  );
  await connection.execute(
    `UPDATE ims_shipping_shipments
        SET revision = revision + 1, status = 'carrier_created', label_ready_at = NULL,
            safe_error = 'A shared label PDF changed. Generate fresh labels and discard old copies.'
      WHERE business_id = ? AND id IN (${shipmentIds.map(() => "?").join(",")})
        AND provider_shipment_id IS NOT NULL AND manifest_id IS NULL AND ims_fulfilled_at IS NULL`,
    [businessId, ...shipmentIds],
  );
}
