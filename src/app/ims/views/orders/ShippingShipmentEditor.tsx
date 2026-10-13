"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PackingPreset } from "@/lib/ims/shipping/packingSuggestions";
import type {
  ShippingAmendmentDraft,
  ShippingAmendmentParcel,
  ShippingAmendmentResult,
  ShippingEditableDetail,
} from "@/lib/ims/shipping/shippingAmendmentTypes";
import type { ShippingQuote } from "@/lib/ims/shipping/shippingQuotes";
import { centimetreInputToMillimetres, millimetresToCentimetreInput } from "@/lib/ims/shipping/parcelDimensions";
import { isAustralianShippingCountry, isPlaceholderShippingCustomerName } from "@/lib/ims/shipping/shippingWorkflow";
import { SHIPPING_EXPORT_PURPOSES } from "@/lib/ims/shipping/customs";
import { buildNonSaleDeclaredValueInputs, buildWorkspaceCustomsRows, getWorkspaceCustomsBlockers } from "@/lib/ims/shipping/workspaceCustoms";
import { workspaceParcelItemLabel, workspaceParcelQuantityIssue } from "@/lib/ims/shipping/workspaceParcelQuantities";
import { mergeRemovedParcelAllocations, workspaceContentsLabel } from "@/lib/ims/shipping/workspacePresentation";

export type ParcelForm = Omit<ShippingAmendmentParcel, "lengthMm" | "widthMm" | "heightMm" | "weightKg" | "allocations"> & {
  lengthCm: string; widthCm: string; heightCm: string; weightKg: string;
  allocations: { soItemId: number; quantity: string }[];
};

export function removeSavedParcel(parcels: readonly ParcelForm[], index: number): ParcelForm[] {
  if (parcels.some((parcel) => parcel.allocations.some((allocation) => !allocation.quantity.trim() || !Number.isFinite(Number(allocation.quantity)) || Number(allocation.quantity) < 0)))
    throw new Error("Correct the item allocation quantities before removing a parcel.");
  return mergeRemovedParcelAllocations(parcels.map((parcel) => ({
    ...parcel, allocations: parcel.allocations.map((allocation) => ({ ...allocation, quantity: Number(allocation.quantity) })),
  })), index).map((parcel, i) => ({ ...parcel, parcelNumber: i + 1, allocations: parcel.allocations.map((allocation) => ({ ...allocation, quantity: String(allocation.quantity) })) }));
}

export function shipmentParcelForm(parcel: ShippingAmendmentParcel): ParcelForm {
  return {
    ...parcel,
    lengthCm: millimetresToCentimetreInput(parcel.lengthMm),
    widthCm: millimetresToCentimetreInput(parcel.widthMm),
    heightCm: millimetresToCentimetreInput(parcel.heightMm),
    weightKg: String(parcel.weightKg),
    allocations: parcel.allocations.map((allocation) => ({ ...allocation, quantity: String(allocation.quantity) })),
  };
}

export function shipmentParcelDraft(parcel: ParcelForm): ShippingAmendmentParcel {
  const dimensions = [parcel.lengthCm, parcel.widthCm, parcel.heightCm, parcel.weightKg];
  if (dimensions.some((value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0))
    throw new Error(`Parcel ${parcel.parcelNumber}: enter positive, finite dimensions and packed weight.`);
  if (parcel.allocations.some((allocation) => !allocation.quantity.trim() || !Number.isFinite(Number(allocation.quantity)) || Number(allocation.quantity) < 0))
    throw new Error(`Parcel ${parcel.parcelNumber}: item quantities must be finite numbers of zero or more.`);
  const result: ShippingAmendmentParcel = {
    parcelId: parcel.parcelId, providerItemId: parcel.providerItemId,
    packagePresetId: parcel.packagePresetId, packageType: parcel.packageType, parcelNumber: parcel.parcelNumber,
    lengthMm: centimetreInputToMillimetres(parcel.lengthCm),
    widthMm: centimetreInputToMillimetres(parcel.widthCm),
    heightMm: centimetreInputToMillimetres(parcel.heightCm),
    weightKg: Number(parcel.weightKg),
    allocations: parcel.allocations.map((allocation) => ({ ...allocation, quantity: Number(allocation.quantity) })).filter((allocation) => allocation.quantity > 0),
  };
  if ([result.lengthMm, result.widthMm, result.heightMm].some((value) => !Number.isFinite(value)))
    throw new Error(`Parcel ${parcel.parcelNumber}: dimensions are outside the supported numeric range.`);
  return result;
}

export function shippingShipmentEditBlocker(status: string): string {
  if (["draft", "failed", "carrier_created", "label_ready", "label_pending"].includes(status)) return "";
  if (["amending", "amendment_unknown"].includes(status)) return "Reconcile the pending amendment before editing.";
  return "Editing is unavailable after dispatch or manifest booking, or while carrier/label actions are in flight.";
}

export function shipmentLabelInvalidationIds(
  shipments: readonly { shipmentId: number; labelUrl: string | null }[],
  shipmentIds: readonly number[],
): number[] {
  const affected = new Set(shipmentIds);
  const staleUrls = new Set(shipments.filter((shipment) => affected.has(shipment.shipmentId))
    .map((shipment) => shipment.labelUrl).filter((url): url is string => Boolean(url)));
  for (const shipment of shipments) {
    if (shipment.labelUrl && staleUrls.has(shipment.labelUrl)) affected.add(shipment.shipmentId);
  }
  return [...affected];
}

const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 8px", background: "var(--sv-bg-1)", color: "var(--sv-text)", border: "1px solid var(--sv-etch)", borderRadius: 4 };
const buttonStyle: CSSProperties = { padding: "8px 12px", background: "var(--sv-bg-2)", color: "var(--sv-text)", border: "1px solid var(--sv-etch)", borderRadius: 4, cursor: "pointer" };
const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);

export function ShippingShipmentEditor({ shipmentId, accounts, presets, onClose, onSaved, onInvalidate, onFailure, mode = "edit" }: {
  mode?: "edit" | "postage";
  shipmentId: number;
  accounts: { id: number; displayName: string }[];
  presets: PackingPreset[];
  onClose: () => void;
  onSaved: (result: ShippingAmendmentResult) => Promise<void>;
  onInvalidate: (shipmentIds: number[]) => number[];
  onFailure: (shipmentIds: number[]) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ShippingEditableDetail | null>(null);
  const [recipient, setRecipient] = useState<ShippingEditableDetail["recipient"] | null>(null);
  const [parcels, setParcels] = useState<ParcelForm[]>([]);
  const [accountId, setAccountId] = useState("");
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [service, setService] = useState<ShippingQuote | null>(null);
  const [busy, setBusy] = useState<"loading" | "quotes" | "save" | "reconcile" | "refresh" | null>("loading");
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [savedResult, setSavedResult] = useState<ShippingAmendmentResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const endpoint = `/api/ims/shipping/shipments/${shipmentId}`;

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to load saved shipment.");
      if (!active) return;
      const saved = result.data as ShippingEditableDetail;
      setDetail(saved);
      setRecipient({ ...saved.recipient, name: saved.suggestedRecipientName ?? saved.recipient.name, lines: [...saved.recipient.lines] });
      setDirty(Boolean(saved.suggestedRecipientName));
      setParcels(saved.parcels.map(shipmentParcelForm));
      setAccountId(saved.carrierAccountId == null ? "" : String(saved.carrierAccountId));
      setUncertain(["amending", "amendment_unknown"].includes(saved.status));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load saved shipment."); })
      .finally(() => { if (active) setBusy(null); });
    dialog.current?.focus();
    return () => { active = false; };
  }, [endpoint]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || uncertain || busy === "save" || busy === "reconcile") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertain, busy]);

  function cancel() {
    if (busy) { setError("Wait for the current operation to finish before closing."); return; }
    if (uncertain && !window.confirm("The carrier amendment outcome is unknown. Closing does not cancel it. Reconcile this shipment before dispatch or further changes. Close anyway?")) return;
    if (!uncertain && dirty && !savedResult && !window.confirm("Discard your unsaved shipment changes?")) return;
    onClose();
  }
  function changed(update: () => void) {
    update();
    setDirty(true);
    setQuotes([]);
    setService(null);
    setError("");
    operation.current = null;
  }
  const carrierCreated = Boolean(detail?.providerShipmentId);
  const recordedCarrierCost = detail?.chargedCost != null && Number.isFinite(detail.chargedCost)
    ? detail.chargedCost : null;
  const enabled = Boolean(detail?.editEligibility.eligible && (!carrierCreated || detail.carrierUpdateEnabled) && !uncertain && !savedResult && !busy);
  const blockReason = detail?.editEligibility.reason ||
    (detail && !detail.editEligibility.eligible ? "The server has blocked editing this shipment." :
      carrierCreated && !detail?.carrierUpdateEnabled ? "Carrier amendment verification is not enabled for this account." : "");

  function draft(): ShippingAmendmentDraft {
    if (!detail || !recipient) throw new Error("Saved shipment details are not loaded.");
    if (isPlaceholderShippingCustomerName(recipient.name)) throw new Error("Enter the actual delivery recipient instead of Online Customer.");
    if (!Number.isInteger(Number(accountId)) || Number(accountId) <= 0) throw new Error("Choose a carrier account.");
    if (!recipient.name.trim() || !recipient.lines.some((line) => line.trim()) || !recipient.suburb.trim() || !recipient.postcode.trim() || !recipient.country.trim())
      throw new Error("Enter recipient name, delivery address, suburb, postcode and country.");
    if (isAustralianShippingCountry(recipient.country) && !recipient.state.trim()) throw new Error("Enter the delivery state.");
    if (carrierCreated && isAustralianShippingCountry(recipient.country) === detail.isInternational)
      throw new Error("Carrier-created shipments must keep their domestic/international destination category.");
    if (!parcels.length) throw new Error("At least one parcel is required.");
    const prepared = parcels.map(shipmentParcelDraft);
    if (prepared.some((parcel) => !parcel.allocations.length)) throw new Error("Every parcel must contain at least one item.");
    const quantityIssue = workspaceParcelQuantityIssue(detail.order.items, prepared);
    if (quantityIssue) throw new Error(quantityIssue);
    const result: ShippingAmendmentDraft = { carrierAccountId: Number(accountId), recipient: { ...recipient, lines: recipient.lines.filter((line) => line.trim()) }, parcels: prepared };
    if (!isAustralianShippingCountry(recipient.country)) {
      if (!detail.customs) throw new Error("No saved international customs snapshot is available. Changing a domestic shipment to international is not supported by this editor.");
      if (!SHIPPING_EXPORT_PURPOSES.includes(detail.customs.exportPurpose)) throw new Error("The saved export purpose is not supported. Correct the shipment customs before editing.");
      if (!["ex_tax", "inc_tax", "no_tax"].includes(detail.order.tax_treatment)) throw new Error("The saved order tax treatment cannot be used for customs.");
      const values: Record<number, string> = {};
      for (const item of detail.customs.parcels.flatMap((parcel) => parcel.items)) {
        if (detail.customs.exportPurpose !== "sale" && values[item.soItemId] != null && values[item.soItemId] !== String(item.unitValue))
          throw new Error("Saved non-sale values disagree between parcels. This editor cannot safely infer a replacement declared value.");
        values[item.soItemId] = String(item.unitValue);
      }
      const rows = buildWorkspaceCustomsRows({
        lines: detail.order.items.map((item) => ({
          id: item.id, productId: item.product_id, sku: item.sku, productName: item.product_name,
          customsDescription: item.customs_description, hsCode: item.hs_code, countryOfOrigin: item.country_of_origin,
          isDangerousOrRestricted: Boolean(item.is_dangerous_or_restricted), weightKg: item.weight_kg,
          unitPrice: item.unit_price, discountPct: item.discount_pct, taxRate: item.tax_rate,
        })),
        allocations: prepared.flatMap((parcel) => parcel.allocations), exportPurpose: detail.customs.exportPurpose,
        taxTreatment: detail.order.tax_treatment as "ex_tax" | "inc_tax" | "no_tax", nonSaleValues: values,
      });
      const blockers = getWorkspaceCustomsBlockers({ rows, exportPurpose: detail.customs.exportPurpose, nonSaleValuesConfirmed: detail.customs.nonSaleValuesConfirmed });
      if (blockers.length) throw new Error(blockers.join(" "));
      result.exportPurpose = detail.customs.exportPurpose;
      result.nonSaleValues = detail.customs.exportPurpose === "sale" ? undefined : buildNonSaleDeclaredValueInputs(rows);
      result.nonSaleValuesConfirmed = detail.customs.nonSaleValuesConfirmed;
    }
    return result;
  }
  async function getQuotes() {
    setError("");
    try {
      const proposed = draft();
      setBusy("quotes");
      setQuotes([]);
      setService(null);
      const response = await fetch(`${endpoint}/quotes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...proposed, expectedRevision: detail!.revision, expectedUpdatedAt: detail!.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to quote proposed shipment.");
      setQuotes(result.data);
      if (!result.data.length) setError("No carrier services are available for these details.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to quote proposed shipment."); }
    finally { setBusy(null); }
  }
  async function finish(result: ShippingAmendmentResult) {
    setSavedResult(result);
    setUncertain(false);
    setDirty(false);
    onInvalidate(result.affectedShipmentIds);
    setBusy("refresh");
    await onSaved(result);
    onClose();
  }
  async function save() {
    setError("");
    let sent = false;
    let attempted = false;
    let confirmed = false;
    let affectedShipmentIds: number[] = [];
    try {
      const proposed = draft();
      if (!service || !quotes.includes(service)) throw new Error("Get fresh quotes and choose a proposed service before saving.");
      if (carrierCreated && !window.confirm(`Update the existing carrier shipment?\nOriginal service quote: ${detail?.service?.serviceName || "Unknown"} ${detail?.service ? money(detail.service.total) : ""}\nPrevious recorded carrier charge: ${recordedCarrierCost == null ? "Not available" : money(recordedCarrierCost)}\nProposed service quote: ${service.serviceName} ${money(service.total)} quoted.\nQuotes may differ from the final carrier charge; no refund is promised. Fresh labels will be required. Discard older printed/downloaded labels.`)) return;
      const payload = { ...proposed, expectedRevision: detail!.revision, expectedUpdatedAt: detail!.updatedAt, service, confirmCarrierUpdate: carrierCreated };
      const serialized = JSON.stringify(payload);
      if (operation.current?.payload !== serialized) operation.current = { payload: serialized, key: crypto.randomUUID() };
      setBusy("save");
      sent = true;
      attempted = true;
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, operationKey: operation.current.key }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        if (result.affectedShipmentIds?.length) affectedShipmentIds = onInvalidate(result.affectedShipmentIds);
        sent = response.status >= 500 || response.status === 409;
        if (response.status === 409) {
          const latestResponse = await fetch(endpoint, { cache: "no-store" });
          const latest = await latestResponse.json();
          if (latestResponse.ok && latest.success && !["amending", "amendment_unknown"].includes(latest.data.status)) {
            sent = false;
            const saved = latest.data as ShippingEditableDetail;
            setDetail(saved);
            setRecipient({ ...saved.recipient, name: saved.suggestedRecipientName ?? saved.recipient.name, lines: [...saved.recipient.lines] });
            setParcels(saved.parcels.map(shipmentParcelForm));
            setAccountId(saved.carrierAccountId == null ? "" : String(saved.carrierAccountId));
            setQuotes([]);
            setService(null);
            setDirty(Boolean(saved.suggestedRecipientName));
            operation.current = null;
            throw new Error(`${result.error || "The shipment changed while you were editing."} Latest saved details have been reloaded; review them and get fresh quotes.`);
          }
        }
        throw new Error(result.error || "Unable to save shipment.");
      }
      sent = false;
      confirmed = true;
      await finish(result.data);
    } catch (reason) {
      if (sent) {
        setUncertain(true);
        affectedShipmentIds = [...new Set([...affectedShipmentIds, ...onInvalidate([shipmentId])])];
      }
      let refreshError = "";
      if (attempted && !confirmed) {
        try { await onFailure(affectedShipmentIds); }
        catch (refreshReason) { refreshError = ` ${refreshReason instanceof Error ? refreshReason.message : "Unable to refresh saved shipment state."}`; }
      }
      setError(`${reason instanceof Error ? reason.message : "Unable to save shipment."}${sent ? " Do not retry Save. Reconcile the outcome first." : ""}${refreshError}`);
    } finally { setBusy(null); }
  }
  async function reconcile() {
    setError("");
    setBusy("reconcile");
    let confirmed = false;
    let affectedShipmentIds: number[] = [];
    try {
      const response = await fetch(`${endpoint}/reconcile`, { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.success) {
        if (result.affectedShipmentIds?.length) affectedShipmentIds = onInvalidate(result.affectedShipmentIds);
        throw new Error(result.error || "The amendment outcome remains unresolved.");
      }
      confirmed = true;
      await finish(result.data);
    } catch (reason) {
      let refreshError = "";
      if (!confirmed) {
        affectedShipmentIds = [...new Set([...affectedShipmentIds, ...onInvalidate([shipmentId])])];
        try { await onFailure(affectedShipmentIds); }
        catch (refreshReason) { refreshError = ` ${refreshReason instanceof Error ? refreshReason.message : "Unable to refresh saved shipment state."}`; }
      }
      setError(`${reason instanceof Error ? reason.message : "The amendment outcome remains unresolved."}${refreshError}`);
    }
    finally { setBusy(null); }
  }

  return <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={mode === "postage" ? "Choose postage service" : "Edit shipment details"} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); cancel(); }
        if (event.key === "Tab") {
          const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
          if (!focusable?.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}
      style={{ width: "min(calc(100vw - 40px), max(920px, 75vw))", boxSizing: "border-box", maxHeight: "calc(100vh - 40px)", overflow: "auto", background: "var(--sv-bg-1)", color: "var(--sv-text)", border: "1px solid var(--sv-etch)", borderRadius: 8, padding: 18 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><h2 style={{ fontSize: 17, minWidth: 0, overflowWrap: "anywhere" }}>{mode === "postage" ? "Choose postage service" : "Edit shipment details"} {detail ? `— ${detail.soNumber}` : ""}</h2><button type="button" style={{ background: "none", border: "none", color: "var(--sv-text-dim)", cursor: "pointer", fontSize: 22, lineHeight: 1, flexShrink: 0 }} title="Close" aria-label="Close shipment editor" onClick={cancel}>&times;</button></header>
      {error && <div role="alert" style={{ color: "var(--sv-red)", marginBottom: 12, whiteSpace: "pre-wrap" }}>{error}</div>}
      {busy === "loading" && <p>Loading exact saved shipment details…</p>}
      {detail && recipient && <>
        {mode === "postage" && <p style={{ fontSize: 12, color: "var(--sv-text-dim)" }}>Get prices for the saved parcel dimensions and choose a service. Saving your choice does not purchase postage.</p>}
        {blockReason && <p role="status" style={{ color: "var(--sv-red)" }}>{blockReason}</p>}
        {uncertain && <p role="status">Amendment outcome needs reconciliation. Do not submit another amendment or dispatch this shipment.</p>}
        <fieldset disabled={!enabled} style={{ border: 0, padding: 0, margin: 0 }}>
          <label style={{ display: "block", marginBottom: 12 }}>Carrier account<select style={inputStyle} value={accountId} disabled={carrierCreated} onChange={(event) => changed(() => setAccountId(event.target.value))}>
            {!accounts.some((account) => String(account.id) === accountId) && <option value={accountId}>Saved account {accountId}</option>}
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
          </select></label>
          <h3 style={{ fontSize: 14 }}>Delivery recipient</h3>
          {detail.suggestedRecipientName && <p role="status" style={{ fontSize: 12 }}>
            The order-specific recipient name is filled in for review. Save the shipment to apply it{carrierCreated ? ", then generate fresh labels" : ""}. Existing labels have not been changed.
          </p>}
          {detail.recipientNameIssue && <p role="alert" style={{ fontSize: 12 }}>{detail.recipientNameIssue} Enter the actual delivery recipient before saving.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            {(["name", "suburb", "state", "postcode", "country", "email", "phone"] as const).map((field) => <label key={field}>{field === "country" ? "Country (two-letter code)" : field[0].toUpperCase() + field.slice(1)}<input style={inputStyle} value={recipient[field]} onChange={(event) => changed(() => setRecipient({ ...recipient, [field]: event.target.value }))} /></label>)}
            <label>Delivery address lines<textarea aria-label="Delivery address lines" style={inputStyle} rows={3} value={recipient.lines.join("\n")} onChange={(event) => changed(() => setRecipient({ ...recipient, lines: event.target.value.split("\n") }))} /></label>
          </div>
          <h3 style={{ fontSize: 14 }}>Saved parcels</h3>
          {parcels.map((parcel, index) => {
            const update = (patch: Partial<ParcelForm>) => changed(() => setParcels((current) => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry)));
            return <section key={parcel.parcelId ?? `new-${index}`} style={{ border: "1px solid var(--sv-etch)", padding: 12, marginBottom: 12, borderRadius: 4 }}>
              <strong>Parcel {parcel.parcelNumber}</strong>
              {!carrierCreated && <button type="button" style={{ ...buttonStyle, float: "right" }} disabled={parcels.length <= 1} onClick={() => {
                if (!window.confirm("Remove this parcel and move its items to the first remaining parcel? Check the packed measurements and weight again.")) return;
                try { const remaining = removeSavedParcel(parcels, index); changed(() => setParcels(remaining)); }
                catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove parcel."); }
              }}>Remove parcel</button>}
              <label style={{ display: "block", margin: "10px 0" }}>Package preset<select style={inputStyle} value={parcel.packagePresetId ?? ""} onChange={(event) => {
                const preset = presets.find((entry) => entry.id === Number(event.target.value));
                update(preset ? { packagePresetId: preset.id, packageType: preset.packageType, lengthCm: millimetresToCentimetreInput(preset.lengthMm), widthCm: millimetresToCentimetreInput(preset.widthMm), heightCm: millimetresToCentimetreInput(preset.heightMm) } : { packagePresetId: null });
              }}>
                <option value="">Custom measurements</option>
                {parcel.packagePresetId && !presets.some((preset) => preset.id === parcel.packagePresetId) && <option value={parcel.packagePresetId}>Saved preset {parcel.packagePresetId}</option>}
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select></label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
                {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((field) => <label key={field}>{({ lengthCm: "Length (cm)", widthCm: "Width (cm)", heightCm: "Height (cm)", weightKg: "Packed weight (kg)" })[field]}<input style={inputStyle} type="number" min="0" step="any" value={parcel[field]} onChange={(event) => update({ [field]: event.target.value })} /></label>)}
              </div>
              <details open={parcels.length > 1 || Boolean(workspaceParcelQuantityIssue(detail.order.items, parcels.map((entry) => ({ allocations: entry.allocations.map((allocation) => ({ ...allocation, quantity: Number(allocation.quantity) })) }))))} style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{parcels.length === 1 ? "Contents: saved item quantities (unchanged)" : "Allocate items between parcels"}</summary>
                {parcels.length === 1 && !workspaceParcelQuantityIssue(detail.order.items, parcels.map((entry) => ({ allocations: entry.allocations.map((allocation) => ({ ...allocation, quantity: Number(allocation.quantity) })) }))) ? <ul style={{ fontSize: 12, paddingLeft: 20 }}>
                  {parcel.allocations.filter((allocation) => Number(allocation.quantity) > 0).map((allocation) => <li key={allocation.soItemId}>{workspaceContentsLabel(detail.order.items.find((item) => item.id === allocation.soItemId) ?? { id: allocation.soItemId })}: {allocation.quantity} units</li>)}
                </ul> : <>
              <p style={{ fontSize: 12 }}>Item quantities, not parcel measurements. Keep the total across parcels unchanged.</p>
              {detail.order.items.map((item) => <label key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                <span>{workspaceParcelItemLabel(item)} <small>({Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled))} remaining to ship across all parcels)</small></span>
                <input aria-label={`${workspaceParcelItemLabel(item)} quantity in parcel ${parcel.parcelNumber}`} style={{ ...inputStyle, width: 100 }} type="number" min="0" step="any" value={parcel.allocations.find((entry) => entry.soItemId === item.id)?.quantity ?? "0"} onChange={(event) => update({ allocations: [...parcel.allocations.filter((entry) => entry.soItemId !== item.id), { soItemId: item.id, quantity: event.target.value }] })} />
              </label>)}
                </>}
              </details>
            </section>;
          })}
          {!carrierCreated && <button type="button" style={buttonStyle} onClick={() => changed(() => setParcels((current) => [...current, { packageType: current[0]?.packageType || "box", parcelNumber: current.length + 1, lengthCm: "", widthCm: "", heightCm: "", weightKg: "", allocations: [] }]))}>Add parcel</button>}
          {detail.customs && <p style={{ fontSize: 12 }}>Saved customs purpose: {detail.customs.exportPurpose}. Saved declared values and confirmation are preserved; updated item allocations are validated before quoting or saving. Product customs details are not editable here.</p>}
        </fieldset>
        <div aria-label="Saved postage summary" style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 14, fontSize: 12 }}>
          <strong>{detail.service?.serviceName || "No postage service selected"}</strong>
          {detail.service && <span>Quote: {money(detail.service.total)}</span>}
          {carrierCreated && <span>Recorded charge: {recordedCarrierCost == null ? "Not available" : money(recordedCarrierCost)}</span>}
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>{quotes.map((quote, index) => <label key={`${quote.serviceCode}-${index}`}><input type="radio" name="amendment-service" disabled={!enabled} checked={service === quote} onChange={() => { setService(quote); setDirty(true); if (service !== quote) operation.current = null; }} /> {quote.serviceName} · {money(quote.total)} quoted</label>)}</div>
        {service && <p>Proposed: {service.serviceName} · {money(service.total)} quoted. Final carrier charges may differ.</p>}
      </>}
      <footer style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        {detail && <button type="button" style={{ ...buttonStyle, marginRight: "auto" }} disabled={!enabled} onClick={() => void getQuotes()}>{busy === "quotes" ? "Getting prices..." : mode === "postage" ? "Get shipping prices" : "Get fresh quotes for proposed details"}</button>}
        <button type="button" style={{ ...buttonStyle, color: "var(--sv-text-main)", padding: "8px 16px", borderRadius: 6, fontSize: 14, fontWeight: 500, transition: "opacity .15s", whiteSpace: "nowrap" }} onClick={cancel} disabled={Boolean(busy)}>Cancel</button>
        {uncertain && <button type="button" style={buttonStyle} disabled={Boolean(busy)} onClick={() => void reconcile()}>{busy === "reconcile" ? "Reconciling…" : "Reconcile amendment outcome"}</button>}
        {savedResult ? <button type="button" style={buttonStyle} disabled={Boolean(busy)} onClick={() => { setBusy("refresh"); setError(""); void finish(savedResult).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to refresh saved batches.")).finally(() => setBusy(null)); }}>Refresh saved shipment state</button> :
          <button type="button" style={{ ...buttonStyle, background: "var(--sv-action)", color: "white", opacity: enabled && service ? 1 : .55 }} disabled={!enabled || !service} onClick={() => void save()}>{busy === "save" ? "Saving..." : mode === "postage" ? "Save postage service" : "Save shipment details"}</button>}
      </footer>
    </div>
  </div>;
}
