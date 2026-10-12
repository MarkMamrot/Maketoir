import { describe, expect, it } from "vitest";
import { groupWorkspaceBatches, mergeRemovedParcelAllocations, workspaceBatchLabel, workspaceContentsLabel, workspaceMembershipBlocker, workspaceShippingStatus } from "../workspacePresentation";

describe("shipping workspace presentation", () => {
  it("shows product names in contents while preserving unmatched Shopify titles", () => {
    expect(workspaceContentsLabel({ id: 1, product_name: "Test product", sku: "123" })).toBe("Test product (123)");
    expect(workspaceContentsLabel({ id: 1, product_name: "Shopify misc", sku: "SHOPIFY-MISC", notes: "Original title" })).toBe("Original title (SHOPIFY-MISC)");
    expect(workspaceContentsLabel({ id: 1 })).toBe("Item 1");
  });
  it("separates unbatched shipments without replacing legacy batch identities", () => {
    const members = [{ batchId: "legacy", id: 1 }, { batchId: null, id: 2 }, { batchId: "legacy", id: 3 }];
    expect(groupWorkspaceBatches(members)).toEqual([{ batchId: "legacy", shipments: [members[0], members[2]] }]);
  });
  it("explains blocked grouping operations", () => {
    expect(workspaceMembershipBlocker({ status: "label_ready", imsFulfilledAt: null, manifestId: null })).toBe("");
    expect(workspaceMembershipBlocker({ status: "failed", imsFulfilledAt: "2026-10-12", manifestId: null })).toContain("Dispatched");
    expect(workspaceMembershipBlocker({ status: "label_ready", imsFulfilledAt: null, manifestId: 2 })).toContain("manifested");
    expect(workspaceMembershipBlocker({ status: "amendment_unknown", imsFulfilledAt: null, manifestId: null })).toContain("Resolve");
  });
  it("uses staff-facing stages and distinguishes stale labels", () => {
    expect(workspaceShippingStatus("draft")).toBe("Ready to create labels");
    expect(workspaceShippingStatus("label_ready")).toBe("Labels ready");
    expect(workspaceShippingStatus("carrier_created", "stale")).toBe("Needs new labels");
    expect(workspaceShippingStatus("amendment_unknown")).toBe("Needs amendment review");
    expect(workspaceShippingStatus("future_state")).toBe("future state");
  });
  it("labels a batch from its earliest creation without requiring extra metadata", () => {
    expect(workspaceBatchLabel([{ createdAt: "bad", soNumber: "SO1" }])).toBe("Batch - SO1");
    expect(workspaceBatchLabel([{ createdAt: "2026-10-12T10:00:00+11:00", soNumber: "SO1" }])).toContain("SO1");
  });
  it("moves every removed-parcel allocation to the first remaining parcel without rounding drift", () => {
    const parcels = [
      { allocations: [{ soItemId: 1, quantity: 0.1 }], weight: "1" },
      { allocations: [{ soItemId: 1, quantity: 0.2 }, { soItemId: 2, quantity: 2 }], weight: "2" },
      { allocations: [{ soItemId: 3, quantity: 1 }], weight: "3" },
    ];
    expect(mergeRemovedParcelAllocations(parcels, 1)).toEqual([
      { allocations: [{ soItemId: 1, quantity: 0.3 }, { soItemId: 2, quantity: 2 }], weight: "1" },
      parcels[2],
    ]);
    expect(parcels[0].allocations[0].quantity).toBe(0.1);
    expect(mergeRemovedParcelAllocations(parcels, 0)[0].allocations).toContainEqual({ soItemId: 1, quantity: 0.3 });
    expect(mergeRemovedParcelAllocations([parcels[0]], 0)).toEqual([parcels[0]]);
    expect(mergeRemovedParcelAllocations(parcels, 99)).toEqual(parcels);
  });
});
