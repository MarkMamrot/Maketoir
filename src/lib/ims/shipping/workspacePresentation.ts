import { workspaceParcelItemLabel } from "./workspaceParcelQuantities";

export function workspaceContentsProductName(item: Parameters<typeof workspaceParcelItemLabel>[0]): string | null {
  const originalName = item.notes?.trim();
  if (item.sku?.trim().toUpperCase() === "SHOPIFY-MISC" && originalName) return originalName;
  return item.product_name?.trim() || null;
}

export function workspaceContentsLabel(item: Parameters<typeof workspaceParcelItemLabel>[0]): string {
  const sku = item.sku?.trim();
  if (sku?.toUpperCase() === "SHOPIFY-MISC") return workspaceParcelItemLabel(item);
  const name = workspaceContentsProductName(item);
  return name ? `${name}${sku ? ` (${sku})` : ""}` : workspaceParcelItemLabel(item);
}

export type WorkspaceShipment = {
  batchId: string | null;
  batchRevision: number;
  revision: number;
  shipmentId: number;
  soId: number;
  soNumber: string;
  channelOrderNumber: string | null;
  customerName: string | null;
  customerNameIssue?: string | null;
  status: string;
  serviceCode: string | null;
  serviceName: string | null;
  quotedCost: number | null;
  chargedCost: number | null;
  providerShipmentId: string | null;
  isInternational: boolean;
  destinationCountry: string | null;
  labelStatus: string | null;
  labelUrl: string | null;
  parcelCount: number;
  createdAt: string;
  updatedAt: string;
  imsFulfilledAt: string | null;
  manifestId: number | null;
};

export function workspaceMembershipBlocker(shipment: Pick<WorkspaceShipment, "status" | "imsFulfilledAt" | "manifestId">): string {
  if (shipment.imsFulfilledAt || shipment.manifestId)
    return "Dispatched or manifested shipments cannot change batches.";
  if (!["draft", "quoting", "failed", "carrier_created", "label_ready"].includes(shipment.status))
    return "Resolve the current shipment or label operation before changing batches.";
  return "";
}

export function groupWorkspaceBatches<T extends { batchId: string | null }>(shipments: readonly T[]): { batchId: string; shipments: T[] }[] {
  const batches = new Map<string, T[]>();
  for (const shipment of shipments) {
    if (shipment.batchId === null) continue;
    batches.set(shipment.batchId, [...(batches.get(shipment.batchId) ?? []), shipment]);
  }
  return [...batches].map(([batchId, members]) => ({ batchId, shipments: members }));
}

export function workspaceShippingStatus(status: string, labelStatus?: string | null): string {
  if (labelStatus === "stale" || labelStatus === "superseded") return "Needs new labels";
  return ({
    draft: "Ready to create labels",
    quoting: "Checking prices",
    carrier_created: "Needs labels",
    label_submitting: "Creating labels",
    label_pending: "Labels processing",
    label_unknown: "Needs label review",
    label_ready: "Labels ready",
    failed: "Needs review",
    amending: "Updating shipment",
    amendment_unknown: "Needs amendment review",
    submitting: "Creating postage",
    submission_unknown: "Needs postage review",
    ims_fulfilled: "Dispatched",
    channel_pending: "Dispatched - tracking pending",
    complete: "Dispatched",
    manifested: "Manifested",
    voided: "Cancelled",
  } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

export function workspaceBatchLabel(shipments: readonly Pick<WorkspaceShipment, "createdAt" | "soNumber">[]): string {
  const dates = shipments.map((shipment) => Date.parse(shipment.createdAt)).filter(Number.isFinite);
  const created = dates.length ? new Date(Math.min(...dates)) : null;
  return created
    ? `Batch ${created.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} - ${shipments[0]?.soNumber ?? ""}`
    : `Batch - ${shipments[0]?.soNumber ?? ""}`;
}

export function mergeRemovedParcelAllocations<T extends { allocations: { soItemId: number; quantity: number }[] }>(
  parcels: readonly T[],
  removedIndex: number,
): T[] {
  if (parcels.length <= 1 || !parcels[removedIndex]) return [...parcels];
  const remaining = parcels.filter((_, index) => index !== removedIndex);
  const allocations = new Map(remaining[0].allocations.map((allocation) => [allocation.soItemId, allocation.quantity]));
  for (const allocation of parcels[removedIndex].allocations)
    allocations.set(allocation.soItemId, Math.round(((allocations.get(allocation.soItemId) ?? 0) + allocation.quantity) * 10_000) / 10_000);
  return remaining.map((parcel, index) => index === 0
    ? { ...parcel, allocations: [...allocations].map(([soItemId, quantity]) => ({ soItemId, quantity })) }
    : parcel);
}
