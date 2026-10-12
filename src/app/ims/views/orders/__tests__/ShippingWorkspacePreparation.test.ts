import { describe, expect, it } from "vitest";
import { initialParcels } from "../ShipOrdersWorkspace";
import { removeSavedParcel, shipmentParcelForm } from "../ShippingShipmentEditor";
import type { PackingPreset } from "@/lib/ims/shipping/packingSuggestions";

const order = {
  id: 1, so_number: "SO1", status: "confirmed", so_type: "online",
  delivery_address: "1 Test Street", delivery_suburb: "Sydney", delivery_state: "NSW", delivery_postcode: "2000", delivery_country: "AU",
  items: [{ id: 10, qty_ordered: 3, qty_fulfilled: 1.5, unit_price: 11, discount_pct: 0, tax_rate: 10, weight_kg: 1, length_mm: 100, width_mm: 100, height_mm: 100 }],
};
const preset: PackingPreset = {
  id: 7, name: "Small box", packageType: "box", lengthMm: 100, widthMm: 100, heightMm: 100, tareWeightKg: 0.1, maxWeightKg: 2, allowRotation: true,
};

describe("measurement-first shipment preparation", () => {
  it("defaults to one parcel containing remaining quantities, never the original ordered quantity", () => {
    const parcels = initialParcels(order, []);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].allocations).toEqual([{ soItemId: 10, quantity: 1.5 }]);
    expect(parcels[0].lengthCm).toBe("");
  });
  it("does not silently apply multiple suggested parcels or invent combined dimensions", () => {
    const parcels = initialParcels(order, [preset]);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].packagePresetId).toBe("");
    expect(parcels[0].allocations[0].quantity).toBe(1.5);
  });
  it("retains an applicable single-parcel suggestion with clearly convertible cm/kg values", () => {
    const parcels = initialParcels({ ...order, items: [{ ...order.items[0], qty_fulfilled: 2 }] }, [preset]);
    expect(parcels[0]).toMatchObject({ packagePresetId: "7", lengthCm: "10", widthCm: "10", heightCm: "10", weightKg: "1.1" });
  });
  it("preserves quantities when removing a local saved parcel and renumbers the remainder", () => {
    const form = shipmentParcelForm({ parcelId: 1, packageType: "box", parcelNumber: 1, lengthMm: 100, widthMm: 100, heightMm: 100, weightKg: 1, allocations: [{ soItemId: 10, quantity: 0.5 }] });
    const second = { ...form, parcelId: 2, parcelNumber: 2, allocations: [{ soItemId: 10, quantity: "1" }] };
    expect(removeSavedParcel([form, second], 1)).toEqual([{ ...form, allocations: [{ soItemId: 10, quantity: "1.5" }] }]);
    expect(() => removeSavedParcel([form, { ...second, allocations: [{ soItemId: 10, quantity: "" }] }], 1)).toThrow("Correct the item allocation");
  });
});
