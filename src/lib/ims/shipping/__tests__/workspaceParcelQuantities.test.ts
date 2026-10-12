import { describe, expect, it } from "vitest";
import {
  workspaceParcelItemLabel,
  workspaceParcelQuantityIssue,
} from "../workspaceParcelQuantities";

const item = {
  id: 10,
  sku: "SHOPIFY-MISC",
  product_name: "Shopify Misc Charge",
  notes: "Original Shopify item",
  qty_ordered: 1,
  qty_fulfilled: 0,
};
const parcel = (quantity: number) => ({
  allocations: [{ soItemId: item.id, quantity }],
});

describe("workspace parcel quantities", () => {
  it("identifies the original Shopify item without hiding the fallback SKU", () => {
    expect(workspaceParcelItemLabel(item)).toBe("Original Shopify item (SHOPIFY-MISC)");
    expect(workspaceParcelItemLabel({ ...item, sku: " shopify-misc " })).toBe(
      "Original Shopify item (shopify-misc)",
    );
    expect(workspaceParcelItemLabel({ ...item, notes: null })).toBe("SHOPIFY-MISC");
    expect(workspaceParcelItemLabel({ ...item, sku: "1033631" })).toBe("1033631");
    expect(workspaceParcelItemLabel({ ...item, sku: null })).toBe("Shopify Misc Charge");
    expect(workspaceParcelItemLabel({ ...item, sku: null, product_name: null })).toBe("Item 10");
  });

  it("explains the screenshot's 120 units entered against one remaining unit", () => {
    expect(workspaceParcelQuantityIssue([item], [parcel(120)])).toBe(
      "Original Shopify item (SHOPIFY-MISC): 120 units entered across all parcels, but 1 unit remains to ship. Reduce the total item quantity to 1. These fields are item counts, not parcel measurements.",
    );
  });

  it("reports under-allocation with the actual total across parcels", () => {
    expect(workspaceParcelQuantityIssue(
      [{ ...item, qty_ordered: 3, qty_fulfilled: 0.5 }],
      [parcel(1), parcel(0.5)],
    )).toContain(
      "1.5 units entered across all parcels, but 2.5 units remain to ship. Increase the total item quantity to 2.5.",
    );
  });

  it("preserves exact and fractional allocations, including fallback lines", () => {
    expect(workspaceParcelQuantityIssue([item], [parcel(1)])).toBe("");
    expect(workspaceParcelQuantityIssue(
      [{ ...item, qty_ordered: 2, qty_fulfilled: 0.5 }],
      [parcel(1), parcel(0.5)],
    )).toBe("");
    expect(workspaceParcelQuantityIssue(
      [{ ...item, qty_fulfilled: 1 }],
      [parcel(0)],
    )).toBe("");
  });

  it("counts every allocation and names the actual mismatched line", () => {
    expect(workspaceParcelQuantityIssue([item], [{
      allocations: [
        { soItemId: item.id, quantity: 0.5 },
        { soItemId: item.id, quantity: 0.5 },
      ],
    }])).toBe("");
    expect(workspaceParcelQuantityIssue(
      [item, { ...item, id: 11, sku: "1033631" }],
      [{ allocations: [{ soItemId: 10, quantity: 1 }, { soItemId: 11, quantity: 20 }] }],
    )).toContain("1033631: 20 units entered across all parcels");
  });
});
