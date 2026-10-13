"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { PackingPreset } from "@/lib/ims/shipping/packingSuggestions";
import type { ShippingEditableDetail } from "@/lib/ims/shipping/shippingAmendmentTypes";
import type { ShippingExportPurpose } from "@/lib/ims/shipping/customs";
import { isAustralianShippingCountry } from "@/lib/ims/shipping/shippingWorkflow";
import { millimetresToCentimetreInput } from "@/lib/ims/shipping/parcelDimensions";
import { buildDimensionPresetInput, validatePackagePresetInput } from "@/lib/ims/shipping/shippingSettings";
import { workspaceParcelItemLabel, workspaceParcelQuantityIssue } from "@/lib/ims/shipping/workspaceParcelQuantities";
import { buildNonSaleDeclaredValueInputs, buildWorkspaceCustomsRows, getWorkspaceCustomsBlockers } from "@/lib/ims/shipping/workspaceCustoms";
import { groupWorkspaceBatches, workspaceBatchLabel, workspaceContentsProductName, workspaceMembershipBlocker, type WorkspaceShipment } from "@/lib/ims/shipping/workspacePresentation";
import { removeSavedParcel, shipmentParcelDraft, shipmentParcelForm, type ParcelForm } from "./ShippingShipmentEditor";
import type { CarrierAccount, SalesOrderDetail, SalesOrderSummary } from "./ShipOrdersWorkspace";
import type { BatchDestination } from "./ShippingBatchControls";

const input: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "8px", border: "1px solid var(--sv-etch)", borderRadius: 5, color: "var(--sv-text)", background: "var(--sv-bg-1)" };
const button: CSSProperties = { padding: "8px 12px", border: "1px solid var(--sv-etch)", borderRadius: 5, color: "var(--sv-text)", background: "var(--sv-bg-2)", cursor: "pointer" };
const preparationButton: CSSProperties = { ...button, width: "100%", minWidth: 0, minHeight: 42, fontSize: 13, fontWeight: 600, lineHeight: 1.4, whiteSpace: "normal" };
const contentsCell: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--sv-etch)", textAlign: "left", overflowWrap: "anywhere", verticalAlign: "top" };
type CardState = { shipmentId: number | null; ready: boolean; dirty: boolean; saving: boolean };
const emptyParcel = (parcelNumber: number): ParcelForm => ({
  parcelNumber, packageType: "custom", lengthCm: "", widthCm: "", heightCm: "", weightKg: "", allocations: [],
});

export function OrderShippingPreparation({ orders, shipments, accounts, presets, busy, destinationBatchId, onChanged, onPresetsChanged, onAdd, onDirtyChange, onBusyChange, onOpenProducts }: {
  orders: SalesOrderSummary[]; shipments: WorkspaceShipment[]; accounts: CarrierAccount[]; presets: PackingPreset[];
  busy: boolean; destinationBatchId: string;
  onChanged: () => Promise<void>;
  onPresetsChanged: () => Promise<void>;
  onAdd: (ids: number[], destination: BatchDestination) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenProducts: () => void;
}) {
  const [states, setStates] = useState<Record<number, CardState>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [destination, setDestination] = useState(destinationBatchId || "new");
  const [accountId, setAccountId] = useState(accounts.length === 1 ? String(accounts[0].id) : "");
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  useEffect(() => { setDestination(destinationBatchId || "new"); }, [destinationBatchId]);
  useEffect(() => {
    const current = orders.map(order => states[order.id]).filter(Boolean);
    callbacks.current.onDirtyChange(current.some(state => state.dirty));
    callbacks.current.onBusyChange(current.some(state => state.saving));
  }, [states, orders]);
  const selection = selected.filter(id => orders.some(order => order.id === id) && states[id]?.ready);
  const batches = groupWorkspaceBatches(shipments).filter(batch => batch.shipments.some(shipment => !workspaceMembershipBlocker(shipment)));
  const selectedBatch = batches.some(batch => batch.batchId === destination) ? destination : "new";
  return <section aria-label="Orders ready to ship" style={{ marginBottom: 20 }}>
    {!orders.length && <p style={{ fontSize: 12 }}>No delivery orders are waiting for parcel preparation.</p>}
    {orders.map((order, index) => <OrderPreparationCard key={order.id} order={order} striped={index % 2 === 1} savedRevision={shipments.find(shipment => shipment.shipmentId === Number(order.preparation_shipment_id))?.revision} presets={presets} busy={busy}
      selected={selection.includes(order.id)}
      onSelect={checked => setSelected(current => checked ? [...new Set([...current, order.id])] : current.filter(id => id !== order.id))}
      onState={state => setStates(current => ({ ...current, [order.id]: state }))}
      onSaved={onChanged} onPresetsChanged={onPresetsChanged} onOpenProducts={onOpenProducts} />)}
    <section aria-label="Make a shipping batch" style={{ marginTop: 16, padding: 16, border: "2px solid var(--sv-etch)", borderRadius: 6, background: "var(--sv-bg-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>Make a shipping batch</strong>
        <span style={{ fontSize: 12, color: "var(--sv-text-dim)" }}>{selection.length} measured order{selection.length === 1 ? "" : "s"} selected</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12, flex: "1 1 200px", maxWidth: 340 }}>Carrier account
        <select aria-label="Batch carrier account" style={input} disabled={busy} value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">Choose an account</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12, flex: "1 1 200px", maxWidth: 340 }}>Add to
        <select aria-label="Preparation destination batch" style={input} disabled={busy} value={selectedBatch} onChange={event => setDestination(event.target.value)}>
          <option value="new">New batch</option>
          {batches.map(batch => <option key={batch.batchId} value={batch.batchId}>{workspaceBatchLabel(batch.shipments)}</option>)}
        </select>
      </label>
      <button type="button" style={{ ...button, minHeight: 38, background: "var(--sv-action)", color: "white", opacity: selection.length && accountId && !busy ? 1 : .55 }} disabled={busy || !accountId || !selection.length || selection.length > 50}
        onClick={async () => {
          const ids = selection.map(id => states[id].shipmentId!);
          if (await onAdd(ids, { batchId: selectedBatch === "new" ? crypto.randomUUID() : selectedBatch, createBatch: selectedBatch === "new", carrierAccountId: Number(accountId) })) setSelected([]);
        }}>{selectedBatch === "new" ? "Create batch with selected orders" : "Add selected orders to batch"}</button>
      </div>
      {selection.length > 50 && <p role="alert" style={{ fontSize: 12 }}>Select no more than 50 orders at once.</p>}
      {!accounts.length && <p role="alert" style={{ fontSize: 12 }}>Add an active carrier account in Settings &gt; Shipping before making a batch. You can still save order dimensions.</p>}
    </section>
  </section>;
}

function OrderPreparationCard({ order, striped, savedRevision, presets, busy, selected, onSelect, onState, onSaved, onPresetsChanged, onOpenProducts }: {
  order: SalesOrderSummary; striped: boolean; savedRevision?: number; presets: PackingPreset[];
  busy: boolean; selected: boolean; onSelect: (checked: boolean) => void;
  onState: (state: CardState) => void; onSaved: () => Promise<void>;
  onPresetsChanged: () => Promise<void>;
  onOpenProducts: () => void;
}) {
  const [parcels, setParcels] = useState<ParcelForm[]>([emptyParcel(1)]);
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [saved, setSaved] = useState<ShippingEditableDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(Boolean(order.preparation_shipment_id));
  const [saving, setSaving] = useState(false);
  const [presetDraft, setPresetDraft] = useState<{ parcelIndex: number; name: string } | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [presetMessage, setPresetMessage] = useState("");
  const presetDraftRef = useRef(presetDraft);
  presetDraftRef.current = presetDraft;
  const [error, setError] = useState("");
  const [showContents, setShowContents] = useState(false);
  const [purpose, setPurpose] = useState<ShippingExportPurpose>("sale");
  const [values, setValues] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const dirtyRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const callbacks = useRef({ onState, onSaved });
  callbacks.current = { onState, onSaved };
  useEffect(() => {
    callbacks.current.onState({
      shipmentId: saved?.shipmentId ?? null, ready: Boolean(saved && !dirty && !loading && !error && !presetDraft),
      dirty: dirty || Boolean(presetDraft), saving: saving || presetSaving,
    });
  }, [saved, dirty, saving, loading, error, presetDraft, presetSaving]);
  const loadSaved = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/ims/shipping/preparation/${order.id}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to load saved dimensions.");
      if (signal?.aborted) return;
      const shipment = result.data?.shipment as ShippingEditableDetail | undefined;
      if (!shipment) throw new Error("Saved preparation is no longer available. Refresh the workstation.");
      const taxTreatment = shipment.order.tax_treatment;
      if (taxTreatment !== "ex_tax" && taxTreatment !== "inc_tax" && taxTreatment !== "no_tax")
        throw new Error("The saved order tax treatment is invalid. Review the Sales Order before preparing it.");
      setSaved(shipment);
      setParcels(shipment.parcels.map(shipmentParcelForm));
      const orderDetail: SalesOrderDetail = {
        ...orderRef.current, ...shipment.order, tax_treatment: taxTreatment,
        items: shipment.order.items.map(item => ({ ...item, is_dangerous_or_restricted: Number(item.is_dangerous_or_restricted) })),
      };
      setDetail(orderDetail);
      setPurpose(shipment.customs?.exportPurpose ?? "sale");
      setValues(Object.fromEntries((shipment.customs?.parcels.flatMap(parcel => parcel.items) ?? []).map(item => [item.soItemId, String(item.unitValue)])));
      setConfirmed(shipment.customs?.nonSaleValuesConfirmed ?? false);
      dirtyRef.current = false;
      setDirty(false);
      operation.current = null;
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Unable to load saved dimensions.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [order.id]);
  useEffect(() => {
    if (!order.preparation_shipment_id) return;
    if (dirtyRef.current || presetDraftRef.current) { setError("Saved preparation changed while you were editing. Reload saved dimensions before continuing."); return; }
    const controller = new AbortController();
    void loadSaved(controller.signal);
    return () => controller.abort();
  }, [order.id, order.preparation_shipment_id, savedRevision, loadSaved]);

  function changed(update: () => void) {
    dirtyRef.current = true;
    setDirty(true);
    setError("");
    operation.current = null;
    update();
  }
  async function loadOrder(): Promise<SalesOrderDetail> {
    if (detail) return detail;
    const response = await fetch(`/api/ims/sales-orders/${order.id}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Unable to load order items.");
    const loaded = result.data as SalesOrderDetail;
    setDetail(loaded);
    return loaded;
  }
  function allocated(current: ParcelForm[], loaded: SalesOrderDetail): ParcelForm[] {
    if (current.length !== 1 || current[0].allocations.length) return current;
    return [{ ...current[0], allocations: (loaded.items ?? []).map(item => ({
      soItemId: item.id, quantity: String(Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled))),
    })).filter(item => Number(item.quantity) > 0) }];
  }
  function customsRows(loaded: SalesOrderDetail, prepared: ParcelForm[], exportPurpose: ShippingExportPurpose = purpose) {
    return buildWorkspaceCustomsRows({
      lines: (loaded.items ?? []).map(item => ({
        id: item.id, productId: item.product_id ?? null, sku: item.sku || "", productName: item.product_name || "",
        customsDescription: item.customs_description ?? null, hsCode: item.hs_code ?? null, countryOfOrigin: item.country_of_origin ?? null,
        isDangerousOrRestricted: Boolean(item.is_dangerous_or_restricted), weightKg: item.weight_kg ?? null,
        unitPrice: Number(item.unit_price), discountPct: Number(item.discount_pct ?? 0), taxRate: Number(item.tax_rate ?? 0),
      })),
      allocations: prepared.flatMap(parcel => parcel.allocations.map(item => ({ ...item, quantity: Number(item.quantity) }))),
      taxTreatment: loaded.tax_treatment ?? "ex_tax", exportPurpose, nonSaleValues: values,
    });
  }
  async function saveDimensions() {
    setSaving(true);
    setError("");
    try {
      const loaded = await loadOrder();
      const prepared = allocated(parcels, loaded);
      const parcelDrafts = prepared.map(shipmentParcelDraft);
      const issue = workspaceParcelQuantityIssue(loaded.items ?? [], parcelDrafts);
      if (issue) throw new Error(issue);
      const international = !isAustralianShippingCountry(loaded.delivery_country || "");
      if (international) {
        const blockers = getWorkspaceCustomsBlockers({
          rows: customsRows(loaded, prepared), exportPurpose: purpose, nonSaleValuesConfirmed: confirmed,
        });
        if (blockers.length) throw new Error(blockers.join(" "));
      }
      const payload = {
        soId: order.id, parcels: parcelDrafts,
        ...(saved ? { expectedRevision: saved.revision, expectedUpdatedAt: saved.updatedAt } : {}),
        ...(international ? {
          exportPurpose: purpose, nonSaleValues: purpose === "sale" ? undefined : buildNonSaleDeclaredValueInputs(customsRows(loaded, prepared)),
          nonSaleValuesConfirmed: purpose === "sale" ? undefined : confirmed,
        } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch(`/api/ims/shipping/preparation/${order.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, operationKey: operation.current.key }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to save dimensions.");
      const shipment = result.data.shipment as ShippingEditableDetail;
      setSaved(shipment);
      setParcels(shipment.parcels.map(shipmentParcelForm));
      dirtyRef.current = false;
      setDirty(false);
      operation.current = null;
      await callbacks.current.onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save dimensions. Retry with unchanged details to check the outcome.");
    } finally { setSaving(false); }
  }
  async function saveDimensionPreset() {
    if (!presetDraft || presetSaving) return;
    const data = buildDimensionPresetInput(presetDraft.name, parcels[presetDraft.parcelIndex]);
    const errors = validatePackagePresetInput(data);
    if (errors.length) { setPresetError(errors.join(" ")); return; }
    if (presets.some(preset => preset.name.trim().toLowerCase() === data.name.toLowerCase())) {
      setPresetError("A preset with that name already exists. Choose a different name or select the existing preset.");
      return;
    }
    setPresetSaving(true);
    setPresetError("");
    setPresetMessage("");
    let created = false;
    try {
      const response = await fetch("/api/ims/shipping/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "preset", data }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to save the dimension preset.");
      created = true;
      setPresetDraft(null);
      await onPresetsChanged();
      setPresetMessage(`Preset "${data.name}" saved and available to all staff in this business.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to save the dimension preset. Check Settings > Shipping before retrying.";
      setPresetError(created ? `The preset was saved, but the list could not be refreshed. Refresh the workstation before saving it again. ${message}` : message);
    } finally { setPresetSaving(false); }
  }
  const disabled = busy || loading || saving || presetSaving;
  const contents = detail ? allocated(parcels, detail) : parcels;
  const international = !isAustralianShippingCountry(order.delivery_country || "");
  const orderFields = [
    ["Sales order", order.so_number],
    ["Channel order", order.shopify_order_name || order.channel_order_number || order.native_checkout_id || "Not supplied"],
    ["Customer", order.customer_name || "No customer name"],
    ["Country", order.delivery_country || "Destination required"],
    ["Ordered units", order.ordered_quantity ?? "Unavailable"],
    ["Units left to ship", order.remaining_quantity ?? "Unavailable"],
    ["Shipping method", order.channel_shipping_method || "Not specified"],
  ] as const;
  return <article aria-label={`Parcel preparation ${order.so_number}`} style={{ padding: 16, borderTop: "2px solid var(--sv-gray-700)", background: striped ? "var(--sv-bg-2)" : "var(--sv-bg-1)", minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", fontSize: 12, paddingBottom: 12, borderBottom: "2px solid var(--sv-etch)" }}>
      <input type="checkbox" aria-label={`Select measured order ${order.so_number}`} disabled={disabled || !saved || dirty || Boolean(error) || Boolean(presetDraft)} checked={selected}
        onChange={event => onSelect(event.target.checked)} />
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <dl aria-label={`Order details for ${order.so_number}`} style={{ display: "flex", flexWrap: "wrap", columnGap: 16, rowGap: 6, margin: 0 }}>
          {orderFields.map(([label, value]) => <div key={label} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <dt style={{ display: "inline", fontWeight: 600 }}>{label}: </dt>
            <dd style={{ display: "inline", margin: 0, fontWeight: label === "Sales order" ? 600 : 400 }}>{value}</dd>
          </div>)}
        </dl>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 8, color: "var(--sv-text-dim)" }}>
          {detail && <span>Delivery address: {saved ? [...saved.recipient.lines, saved.recipient.suburb, saved.recipient.state, saved.recipient.postcode].filter(Boolean).join(", ") : [detail.delivery_address, detail.delivery_suburb, detail.delivery_state, detail.delivery_postcode].filter(Boolean).join(", ")}</span>}
          <span role="status" style={{ marginLeft: "auto", color: saved && !dirty && !error ? "var(--sv-green)" : "var(--sv-text-dim)" }}>{loading ? "Loading saved dimensions..." : saving ? "Saving dimensions..." : presetSaving ? "Saving preset..." : error ? "Needs attention" : saved && !dirty ? "Dimensions saved · ready for batch" : dirty ? "Unsaved dimensions" : "Dimensions required"}</span>
        </div>
      </div>
    </div>
    <fieldset disabled={disabled} style={{ padding: 0, margin: "12px 0 0", border: 0, minWidth: 0 }}>
      {parcels.map((parcel, index) => <div key={index} style={{ marginTop: index ? 12 : 0 }}>
        {parcels.length > 1 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>Parcel {index + 1}<button type="button" style={button} disabled={Boolean(presetDraft)} onClick={() => {
          if (!window.confirm("Remove this parcel and move its items to the first parcel? Recheck packed measurements and weight.")) return;
          try { const remaining = removeSavedParcel(parcels, index); changed(() => setParcels(remaining)); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove parcel."); }
        }}>Remove parcel</button></div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
          <label style={{ fontSize: 12 }}>Preset (optional)<select aria-label={`${order.so_number} parcel ${index + 1} preset`} style={input} value={parcel.packagePresetId ?? ""} onChange={event => {
            const preset = presets.find(item => item.id === Number(event.target.value));
            changed(() => setParcels(current => current.map((item, i) => i !== index ? item : { ...item, packagePresetId: preset?.id ?? null, packageType: preset?.packageType || "custom",
              ...(preset ? { lengthCm: millimetresToCentimetreInput(preset.lengthMm), widthCm: millimetresToCentimetreInput(preset.widthMm), heightCm: millimetresToCentimetreInput(preset.heightMm) } : {}),
            })));
          }}><option value="">Manual dimensions</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
          {([["lengthCm", "Length (cm)"], ["widthCm", "Width (cm)"], ["heightCm", "Height (cm)"], ["weightKg", "Packed weight (kg)"]] as const).map(([field, label]) => <label key={field} style={{ fontSize: 12 }}>{label}<input aria-label={`${order.so_number} parcel ${index + 1} ${label}`} style={input} type="number" min="0" step="any" value={parcel[field]} onChange={event => changed(() => setParcels(current => current.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item)))} /></label>)}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" style={{ ...button, fontSize: 12 }} disabled={Boolean(presetDraft)} onClick={() => {
            setPresetDraft({ parcelIndex: index, name: "" }); setPresetError(""); setPresetMessage("");
          }}>Save as preset</button>
        </div>
        {presetDraft?.parcelIndex === index && <form aria-label={`Save dimension preset for ${order.so_number} parcel ${index + 1}`} style={{ marginTop: 8, padding: 12, border: "1px solid var(--sv-etch)", borderRadius: 5, background: "var(--sv-bg-2)", fontSize: 12 }} onSubmit={event => {
          event.preventDefault(); void saveDimensionPreset();
        }}>
          <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
            <label style={{ flex: "1 1 180px", maxWidth: 300 }}>Preset name<input aria-label={`${order.so_number} preset name`} style={input} maxLength={120} value={presetDraft.name} onChange={event => { setPresetDraft({ ...presetDraft, name: event.target.value }); setPresetError(""); }} /></label>
            <button type="submit" style={button}>{presetSaving ? "Saving preset..." : "Save preset"}</button>
            <button type="button" style={button} onClick={() => { setPresetDraft(null); setPresetError(""); }}>Cancel preset</button>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--sv-text-dim)" }}>Saves this parcel&apos;s length, width and height for all staff in this business. Packed weight is not saved; weigh each future parcel.</p>
        </form>}
        {parcels.length > 1 && <details style={{ fontSize: 12, marginTop: 8 }} open><summary>Allocate items between parcels</summary>{(detail?.items ?? []).map(item => <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>{workspaceParcelItemLabel(item)}<input aria-label={`${order.so_number} parcel ${index + 1} allocation ${item.id}`} style={{ ...input, width: 80 }} type="number" min="0" step="any" value={parcel.allocations.find(allocation => allocation.soItemId === item.id)?.quantity ?? "0"} onChange={event => changed(() => setParcels(current => current.map((p, i) => i !== index ? p : { ...p, allocations: (detail?.items ?? []).map(line => ({ soItemId: line.id, quantity: line.id === item.id ? event.target.value : p.allocations.find(allocation => allocation.soItemId === line.id)?.quantity ?? "0" })) })))} /></label>)}</details>}
      </div>)}
      {presetError && <div role="alert" style={{ marginTop: 8, color: "var(--sv-red)", fontSize: 12 }}>{presetError}</div>}
      {presetMessage && <div role="status" style={{ marginTop: 8, fontSize: 12 }}>{presetMessage}</div>}
      <p style={{ fontSize: 11, color: "var(--sv-text-dim)", margin: "6px 0" }}>Use actual packed measurements, including packaging. All remaining items go in one parcel unless you split it.</p>
      <div id={`shipping-order-contents-${order.id}`} hidden={!showContents} style={{ marginTop: 12, border: "1px solid var(--sv-etch)", borderRadius: 5, overflow: "hidden" }}>
        <table aria-label={`Contents of ${order.so_number}`} style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 12 }}>
          <colgroup><col style={{ width: "52%" }} /><col style={{ width: "28%" }} /><col style={{ width: "20%" }} /></colgroup>
          <thead style={{ background: "var(--sv-bg-2)", color: "var(--sv-text-strong)" }}>
            <tr><th scope="col" style={{ ...contentsCell, borderBottomWidth: 2 }}>Product</th><th scope="col" style={{ ...contentsCell, borderBottomWidth: 2 }}>SKU / Code</th><th scope="col" style={{ ...contentsCell, borderBottomWidth: 2, textAlign: "right" }}>Qty to ship</th></tr>
          </thead>
          <tbody>{(detail?.items ?? []).map((item, index) => <tr key={item.id} style={{ background: index % 2 ? "var(--sv-bg-2)" : "var(--sv-bg-1)" }}>
            <td style={contentsCell}>{workspaceContentsProductName(item) || "Product name unavailable"}</td>
            <td style={contentsCell}>{item.sku?.trim() || "No code"}</td>
            <td style={{ ...contentsCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled))}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {international && <div style={{ marginTop: 12, fontSize: 12 }}>
        <strong>Customs declaration</strong>{" "}
        <button type="button" style={button} onClick={async () => {
          try { await loadOrder(); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load customs information."); }
        }}>Review customs</button>
        <label>Customs purpose<select aria-label={`${order.so_number} customs purpose`} value={purpose} style={{ ...input, maxWidth: 260 }} onChange={async event => {
          const next = event.target.value as ShippingExportPurpose;
          changed(() => { setPurpose(next); setConfirmed(false); });
          try {
            const loaded = await loadOrder();
            if (next !== "sale") setValues(Object.fromEntries(customsRows(loaded, allocated(parcels, loaded), "sale").map(row => [row.id, row.unitValue == null ? "" : row.unitValue.toFixed(2)])));
          } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load customs."); }
        }}><option value="sale">Sale</option><option value="gift">Gift</option><option value="sample">Sample</option><option value="return">Return</option></select></label>
        {purpose !== "sale" && detail && <>
          {customsRows(detail, contents).map(row => <label key={row.id} style={{ display: "block", marginTop: 6 }}>{row.productName || row.sku} · declared unit value (AUD)<input style={{ ...input, maxWidth: 160 }} type="number" min="0" step="any" value={values[row.id] ?? ""} onChange={event => changed(() => { setValues(current => ({ ...current, [row.id]: event.target.value })); setConfirmed(false); })} /></label>)}
          <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={confirmed} onChange={event => changed(() => setConfirmed(event.target.checked))} /> I confirm these non-sale declared values are complete and accurate.</label>
        </>}
        {detail && customsRows(detail, contents).map(row => <div key={row.id} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--sv-etch)" }}>
          <strong>{row.productName || row.sku}</strong>
          <div>{row.sku} · {row.quantity} units · {row.customsDescription || "Customs description required"}</div>
          <div>HS code: {row.hsCode || "Required"} · Origin: {row.countryOfOrigin || "Required"}</div>
          <div>Declared unit value: {row.unitValue == null ? "Required" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(row.unitValue)} · Total: {row.totalValue == null ? "Required" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(row.totalValue)}</div>
        </div>)}
        {detail && getWorkspaceCustomsBlockers({ rows: customsRows(detail, contents), exportPurpose: purpose, nonSaleValuesConfirmed: confirmed }).map(message => <div key={message} role="status" style={{ color: "var(--sv-red)", marginTop: 4 }}>{message}</div>)}
        <button type="button" style={{ ...button, marginTop: 8 }} onClick={onOpenProducts}>Update product customs in Products</button>
        <p style={{ color: "var(--sv-text-dim)" }}>Product customs information and declarations are checked when saving. Correct missing product details in Products before continuing.</p>
      </div>}
      {saved && <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--sv-text-dim)" }}>Changes require a new postage selection in the batch.</p>}
      <div role="group" aria-label={`Preparation actions for ${order.so_number}`} style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, width: "100%", maxWidth: 600, marginTop: 14, paddingTop: 12, borderTop: "2px solid var(--sv-etch)" }}>
        <button type="button" style={{ ...preparationButton, background: "var(--sv-action)", color: "white" }} disabled={Boolean(presetDraft) || (saved !== null && !dirty)} onClick={() => void saveDimensions()}>{saving ? "Saving..." : "Save dimensions"}</button>
        <button type="button" style={preparationButton} aria-expanded={showContents} aria-controls={`shipping-order-contents-${order.id}`} onClick={async () => {
          setError("");
          try { await loadOrder(); setShowContents(current => !current); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to show items."); }
        }}>{showContents ? "Hide contents" : "Show contents"}</button>
        <button type="button" style={preparationButton} disabled={Boolean(presetDraft)} onClick={async () => {
          try { const loaded = await loadOrder(); changed(() => setParcels(current => [...allocated(current, loaded), { ...emptyParcel(current.length + 1), allocations: (loaded.items ?? []).map(item => ({ soItemId: item.id, quantity: "0" })) }])); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to split parcels."); }
        }}>Split into another parcel</button>
      </div>
    </fieldset>
    {error && <div role="alert" style={{ marginTop: 8, color: "var(--sv-red)", fontSize: 12 }}>{error}{order.preparation_shipment_id && <button type="button" disabled={saving || busy} style={{ ...button, marginLeft: 8 }} onClick={() => {
      if ((dirtyRef.current || presetDraftRef.current) && !window.confirm("Reload saved dimensions and discard your unsaved changes?")) return;
      setPresetDraft(null); setPresetError("");
      void loadSaved();
    }}>Reload saved dimensions</button>}</div>}
  </article>;
}
