import { describe, expect, it } from "vitest";

import { buildShippingStockReadiness } from "../stockReadiness";

const baseDemand = {
  shipmentId: 10,
  soId: 20,
  soNumber: "SO-20",
  locationId: 4,
  locationName: "Newtown",
  variantId: "variant-1",
  sku: "SKU-1",
  productName: "Product one",
  requestedQuantity: 1,
  quantityOnHand: 1,
  quantityCommitted: 2,
  purchaseOrderIncomingQuantity: 0,
};

describe("shipping stock readiness", () => {
  it("aggregates batch demand against one shared stock balance", () => {
    const result = buildShippingStockReadiness([
      baseDemand,
      { ...baseDemand, shipmentId: 11, soId: 21, soNumber: "SO-21" },
    ], []);

    expect(result.ready).toBe(false);
    expect(result.lines[0]).toMatchObject({
      shipmentIds: [10, 11],
      soNumbers: ["SO-20", "SO-21"],
      requestedQuantity: 2,
      quantityOnHand: 1,
      shortfallQuantity: 1,
      uncoveredQuantity: 1,
    });
  });

  it("shows outstanding incoming transfers without treating them as on-hand", () => {
    const result = buildShippingStockReadiness([
      { ...baseDemand, requestedQuantity: 3 },
    ], [{
      transferId: 7,
      transferNumber: "BT-7",
      status: "partial",
      locationId: 4,
      variantId: "variant-1",
      quantity: 2,
    }]);

    expect(result.ready).toBe(false);
    expect(result.lines[0]).toMatchObject({
      shortfallQuantity: 2,
      incomingTransferQuantity: 2,
      coveredByIncomingTransfer: 2,
      uncoveredQuantity: 0,
      transfers: [{ transferNumber: "BT-7", status: "partial", quantity: 2 }],
    });
  });

  it("reports only the uncovered part of a shortage", () => {
    const result = buildShippingStockReadiness([
      { ...baseDemand, requestedQuantity: 5 },
    ], [{
      transferId: 8,
      transferNumber: "BT-8",
      status: "sent",
      locationId: 4,
      variantId: "variant-1",
      quantity: 1.5,
    }]);

    expect(result.lines[0]).toMatchObject({
      shortfallQuantity: 4,
      coveredByIncomingTransfer: 1.5,
      uncoveredQuantity: 2.5,
    });
  });
});