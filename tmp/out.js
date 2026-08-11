"use client";
import React, { useEffect, useMemo, useState } from "react";
import { buildSalesOrderFulfilmentRequest } from "./salesOrderFulfilmentRequest";
function SalesOrderFulfilmentModal({
  order,
  items,
  onClose,
  onResolved
}) {
  const [mode, setMode] = useState("partial");
  const [quantities, setQuantities] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const initial = {};
    items.forEach((item) => {
      const outstanding = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0));
      initial[item.id] = String(outstanding);
    });
    setQuantities(initial);
  }, [items]);
  const summary = useMemo(() => {
    const totalOrdered = items.reduce((sum, item) => sum + Number(item.qty_ordered || 0), 0);
    const totalOutstanding = items.reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0)), 0);
    return { totalOrdered, totalOutstanding };
  }, [items]);
  async function submit() {
    setSaving(true);
    setError("");
    try {
      const payloadItems = items.map((item) => ({ itemId: item.id, quantity: Number(quantities[item.id] ?? 0) })).filter((item) => item.quantity > 0);
      if (payloadItems.length === 0) {
        throw new Error("Enter at least one positive quantity.");
      }
      const request = buildSalesOrderFulfilmentRequest(mode, Number(order.id), payloadItems);
      const response = await fetch(request.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationKey: crypto.randomUUID(), ...request.body })
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || "Fulfilment failed.");
      await onResolved();
      onClose();
    } catch (e) {
      setError(e.message || "Fulfilment failed.");
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 1e4, background: "rgba(0,0,0,.68)", display: "grid", placeItems: "center", padding: 16 }, onMouseDown: (e) => {
    if (e.target === e.currentTarget && !saving) onClose();
  } }, /* @__PURE__ */ React.createElement("div", { style: { width: "min(760px, 100%)", maxHeight: "92vh", overflow: "auto", background: "var(--sv-surface,#18202b)", color: "var(--sv-text,#fff)", border: "1px solid var(--sv-border,#364152)", borderRadius: 14, padding: 22, boxShadow: "0 24px 80px rgba(0,0,0,.45)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 12 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--sv-mint,#34d399)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" } }, "Fulfil sales order"), /* @__PURE__ */ React.createElement("h2", { style: { margin: "5px 0 4px" } }, order.so_number || order.po_number || "Sales order"), /* @__PURE__ */ React.createElement("p", { style: { margin: 0, color: "var(--sv-text-dim,#aab4c2)", fontSize: 13 } }, "Choose whether to ship the quantities now and leave the rest open, or split the remainder into a child backorder.")), /* @__PURE__ */ React.createElement("button", { onClick: onClose, disabled: saving, style: { background: "none", border: 0, color: "inherit", fontSize: 24, cursor: "pointer" } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 10, marginTop: 20 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "block", padding: 12, border: `1px solid ${mode === "partial" ? "var(--sv-mint,#34d399)" : "var(--sv-border,#364152)"}`, borderRadius: 9, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", checked: mode === "partial", onChange: () => setMode("partial") }), /* @__PURE__ */ React.createElement("strong", null, "Partially fulfil now"), /* @__PURE__ */ React.createElement("div", { style: { margin: "4px 0 0 22px", fontSize: 12, color: "var(--sv-text-dim,#aab4c2)" } }, "Ship the quantities entered below now and leave any remaining amount outstanding for a short delay.")), /* @__PURE__ */ React.createElement("label", { style: { display: "block", padding: 12, border: `1px solid ${mode === "backorder" ? "var(--sv-mint,#34d399)" : "var(--sv-border,#364152)"}`, borderRadius: 9, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", checked: mode === "backorder", onChange: () => setMode("backorder") }), /* @__PURE__ */ React.createElement("strong", null, "Create backorder for remainder"), /* @__PURE__ */ React.createElement("div", { style: { margin: "4px 0 0 22px", fontSize: 12, color: "var(--sv-text-dim,#aab4c2)" } }, "Fulfil the quantities entered now and move the rest to a held child backorder for later dispatch."))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 18, padding: 12, border: "1px solid var(--sv-border,#364152)", borderRadius: 9, background: "var(--sv-bg-2,#111827)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--sv-text-dim,#aab4c2)", marginBottom: 8 } }, "Fulfil ", summary.totalOutstanding, " of ", summary.totalOrdered, " outstanding units."), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, items.map((item) => {
    const outstanding = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0));
    return /* @__PURE__ */ React.createElement("div", { key: item.id, style: { display: "grid", gap: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--sv-text-dim,#aab4c2)" } }, item.sku || item.product_name || `Line ${item.id}`), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12, color: "var(--sv-text-dim,#aab4c2)" } }, "Qty"), /* @__PURE__ */ React.createElement("input", { type: "number", min: 0, step: 1, value: quantities[item.id] ?? "", onChange: (e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value })), style: { width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--sv-etch,#4b5563)", background: "var(--sv-bg-1,#0f172a)", color: "inherit" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--sv-text-dim,#aab4c2)" } }, "of ", outstanding)));
  }))), error ? /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, padding: 10, borderRadius: 7, background: "rgba(248,113,113,.12)", color: "#fecaca", fontSize: 13 } }, error) : null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { onClick: onClose, disabled: saving, style: { padding: "8px 12px", borderRadius: 8, background: "transparent", border: "1px solid var(--sv-border,#364152)", color: "inherit", cursor: "pointer" } }, "Cancel"), /* @__PURE__ */ React.createElement("button", { onClick: submit, disabled: saving, style: { padding: "8px 12px", borderRadius: 8, background: "var(--sv-mint,#34d399)", color: "#052e16", fontWeight: 700, cursor: "pointer" } }, saving ? "Saving\u2026" : "Confirm"))));
}
export {
  SalesOrderFulfilmentModal
};
