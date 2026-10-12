import { describe, expect, it } from "vitest";
import { shipmentParcelDraft, shipmentParcelForm, shippingShipmentEditBlocker, shipmentLabelInvalidationIds } from "../ShippingShipmentEditor";
import type { ShippingAmendmentParcel } from "@/lib/ims/shipping/shippingAmendmentTypes";

const saved: ShippingAmendmentParcel = {
  parcelId: 42, providerItemId: "existing-provider-item", packagePresetId: 7,
  packageType: "box", parcelNumber: 2, lengthMm: 123, widthMm: 456, heightMm: 78,
  weightKg: 1.234, allocations: [{ soItemId: 3, quantity: 1.5 }],
};

describe("saved shipment parcel editor", () => {
  it("hydrates saved values without packing suggestions and retains carrier identities", () => {
    const form = shipmentParcelForm(saved);
    expect(form.lengthCm).toBe("12.3");
    expect(form.widthCm).toBe("45.6");
    expect(form.heightCm).toBe("7.8");
    expect(shipmentParcelDraft(form)).toEqual(saved);
  });

  it.each(["", " ", "-1", "NaN", "Infinity", "1e309"])("rejects invalid dimensions %j before serialization", (value) => {
    expect(() => shipmentParcelDraft({ ...shipmentParcelForm(saved), lengthCm: value })).toThrow(/dimensions/);
  });

  it("rejects finite centimetres that overflow during millimetre conversion", () => {
    expect(() => shipmentParcelDraft({ ...shipmentParcelForm(saved), lengthCm: "1e308" })).toThrow(/numeric range/);
  });

  it.each(["", "-1", "NaN", "Infinity"])("rejects invalid item counts %j", (quantity) => {
    expect(() => shipmentParcelDraft({ ...shipmentParcelForm(saved), allocations: [{ soItemId: 3, quantity }] })).toThrow(/item quantities/);
  });

  it("retains fractional item counts and omits zero allocations", () => {
    const form = shipmentParcelForm(saved);
    form.allocations.push({ soItemId: 4, quantity: "0" });
    expect(shipmentParcelDraft(form).allocations).toEqual(saved.allocations);
  });

  it.each(["ims_fulfilled", "complete", "manifested", "voided", "submitting", "submission_unknown", "label_submitting", "label_unknown", "amending", "amendment_unknown"])("blocks editing %s summaries", (status) => {
    expect(shippingShipmentEditBlocker(status)).not.toBe("");
  });

  it.each(["draft", "failed", "carrier_created", "label_ready", "label_pending"])("defers %s eligibility to the authoritative detail endpoint", (status) => {
    expect(shippingShipmentEditBlocker(status)).toBe("");
  });

  it("invalidates every affected shipment and shared-PDF sibling without changing unrelated members", () => {
    expect(shipmentLabelInvalidationIds([
      { shipmentId: 1, labelUrl: "shared-old.pdf" },
      { shipmentId: 2, labelUrl: "shared-old.pdf" },
      { shipmentId: 3, labelUrl: "unrelated.pdf" },
      { shipmentId: 4, labelUrl: null },
    ], [1, 4, 5])).toEqual([1, 4, 5, 2]);
  });

  it("does not treat missing labels as a shared PDF", () => {
    expect(shipmentLabelInvalidationIds([
      { shipmentId: 1, labelUrl: null }, { shipmentId: 2, labelUrl: null },
    ], [1])).toEqual([1]);
  });
});
