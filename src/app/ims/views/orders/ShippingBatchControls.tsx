"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { groupWorkspaceBatches, workspaceBatchLabel, workspaceMembershipBlocker, workspaceShippingStatus, type WorkspaceShipment } from "@/lib/ims/shipping/workspacePresentation";

const button: CSSProperties = { border: "1px solid var(--sv-etch)", borderRadius: 5, padding: "7px 10px", background: "var(--sv-bg-2)", color: "var(--sv-text)", cursor: "pointer", fontSize: 12 };

export type BatchDestination = { batchId: string | null; createBatch?: boolean };

export function ShippingBatchControls({ selected, shipments, busy, onMove, onClear, initialDestination = "unbatched" }: {
  selected: number[];
  shipments: WorkspaceShipment[];
  busy: boolean;
  onMove: (ids: number[], destination: BatchDestination) => void;
  onClear: () => void;
  initialDestination?: "unbatched" | "new";
}) {
  const [destination, setDestination] = useState<string>(initialDestination);
  if (!selected.length) return null;
  return <section aria-label="Selected shipment batch actions" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 12, marginBottom: 12, border: "1px solid var(--sv-etch)", borderRadius: 6 }}>
    <strong style={{ fontSize: 12 }}>{selected.length} shipment{selected.length === 1 ? "" : "s"} selected</strong>
    <label style={{ fontSize: 12 }}>Destination{" "}
      <select aria-label="Batch destination" disabled={busy} style={button} value={destination} onChange={(event) => setDestination(event.target.value)}>
        <option value="unbatched">Unbatched shipments</option>
        <option value="new">New batch</option>
        {groupWorkspaceBatches(shipments).filter((batch) => batch.shipments.some((shipment) => !workspaceMembershipBlocker(shipment))).map((batch) => <option key={batch.batchId} value={batch.batchId}>{workspaceBatchLabel(batch.shipments)}</option>)}
      </select>
    </label>
    <button type="button" style={button} disabled={busy} onClick={() => onMove(selected, { batchId: destination === "unbatched" ? null : destination === "new" ? crypto.randomUUID() : destination, createBatch: destination === "new" })}>{busy ? "Updating..." : destination === "unbatched" ? "Remove from batch" : "Move to batch"}</button>
    <button type="button" style={button} disabled={busy} onClick={onClear}>Clear selection</button>
    <span style={{ fontSize: 11, color: "var(--sv-text-dim)", flexBasis: "100%" }}>Preparation and existing postage are retained. Removing a shipment does not cancel postage.</span>
  </section>;
}

export function UnbatchedShipments({ shipments, allShipments, busy, onMove, onEdit }: {
  shipments: WorkspaceShipment[];
  allShipments: WorkspaceShipment[];
  busy: boolean;
  onMove: (ids: number[], destination: BatchDestination) => void;
  onEdit: (id: number) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const visibleSelected = selected.filter((id) => shipments.some((shipment) => shipment.shipmentId === id));
  if (!shipments.length) return null;
  return <section aria-label="Unbatched shipments" style={{ marginBottom: 20 }}>
    <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Unbatched shipments ({shipments.length})</h3>
    <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--sv-text-dim)" }}>Saved preparation is retained. Any postage already created remains active; add these shipments to a batch rather than preparing them again.</p>
    <ShippingBatchControls initialDestination="new" selected={visibleSelected} shipments={allShipments} busy={busy} onMove={(ids, destination) => onMove(ids, destination)} onClear={() => setSelected([])} />
    {shipments.map((shipment) => {
      const blocker = workspaceMembershipBlocker(shipment);
      return <div key={shipment.shipmentId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--sv-etch)", fontSize: 12 }}>
        <input type="checkbox" aria-label={`Select ${shipment.soNumber} unbatched shipment`} disabled={busy || Boolean(blocker)} checked={visibleSelected.includes(shipment.shipmentId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, shipment.shipmentId] : current.filter((id) => id !== shipment.shipmentId))} />
        <strong>{shipment.channelOrderNumber || shipment.soNumber}</strong>
        <span>{shipment.customerName}</span>
        <span>{workspaceShippingStatus(shipment.status, shipment.labelStatus)}</span>
        <button type="button" style={button} disabled={busy || Boolean(blocker) && !["amending", "amendment_unknown"].includes(shipment.status)} onClick={() => onEdit(shipment.shipmentId)}>{["amending", "amendment_unknown"].includes(shipment.status) ? "Review amendment outcome" : "Edit shipment details"}</button>
        {blocker && <span role="status" style={{ color: "var(--sv-text-dim)", flexBasis: "100%" }}>{blocker}</span>}
      </div>;
    })}
  </section>;
}
