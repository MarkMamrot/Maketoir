import { describe, expect, it } from "vitest";

import {
  buildNonSaleDeclaredValueInputs,
  buildWorkspaceCustomsRows,
  getWorkspaceCustomsBlockers,
  type WorkspaceCustomsLine,
} from "../workspaceCustoms";

const line: WorkspaceCustomsLine = {
  id: 10,
  productId: "product-1",
  sku: "SHIRT-BLU-M",
  productName: "Blue shirt",
  customsDescription: "Cotton shirt",
  hsCode: "6105.10",
  countryOfOrigin: "au",
  isDangerousOrRestricted: false,
  weightKg: 0.2,
  unitPrice: 110,
  discountPct: 10,
  taxRate: 0.1,
};

describe("shipping workspace customs", () => {
  it("keeps declaration quantities aligned with parcel allocations and mirrors sale valuation", () => {
    const rows = buildWorkspaceCustomsRows({
      lines: [line],
      allocations: [
        { soItemId: 10, quantity: 0.5 },
        { soItemId: 10, quantity: 1.5 },
      ],
      exportPurpose: "sale",
      taxTreatment: "inc_tax",
      nonSaleValues: {},
    });
    expect(rows[0]).toMatchObject({
      quantity: 2,
      unitValue: 90,
      totalValue: 180,
      hsCode: "610510",
      countryOfOrigin: "AU",
    });
    expect(getWorkspaceCustomsBlockers({
      rows,
      exportPurpose: "sale",
      nonSaleValuesConfirmed: false,
    })).toEqual([]);
  });

  it("blocks incomplete product customs data and unconfirmed non-sale values", () => {
    const rows = buildWorkspaceCustomsRows({
      lines: [{
        ...line,
        customsDescription: "",
        hsCode: "123",
        countryOfOrigin: null,
        isDangerousOrRestricted: true,
      }],
      allocations: [{ soItemId: 10, quantity: 1 }],
      exportPurpose: "gift",
      taxTreatment: "inc_tax",
      nonSaleValues: {},
    });
    expect(getWorkspaceCustomsBlockers({
      rows,
      exportPurpose: "gift",
      nonSaleValuesConfirmed: false,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("customs description"),
      expect.stringContaining("HS code"),
      expect.stringContaining("country of origin"),
      expect.stringContaining("dangerous or restricted"),
      expect.stringContaining("declared unit value"),
      expect.stringContaining("Confirm"),
    ]));
  });

  it("builds only the non-sale value inputs accepted by the draft contract", () => {
    const rows = buildWorkspaceCustomsRows({
      lines: [line],
      allocations: [{ soItemId: 10, quantity: 2 }],
      exportPurpose: "return",
      taxTreatment: "ex_tax",
      nonSaleValues: { 10: "25.125" },
    });
    expect(buildNonSaleDeclaredValueInputs(rows)).toEqual([
      { soItemId: 10, unitValue: 25.13 },
    ]);
  });

  it("blocks a sale line whose calculated declared value is not positive", () => {
    const rows = buildWorkspaceCustomsRows({
      lines: [{ ...line, unitPrice: 0 }],
      allocations: [{ soItemId: 10, quantity: 1 }],
      exportPurpose: "sale",
      taxTreatment: "inc_tax",
      nonSaleValues: {},
    });
    expect(getWorkspaceCustomsBlockers({
      rows,
      exportPurpose: "sale",
      nonSaleValuesConfirmed: false,
    })).toContain("SHIRT-BLU-M: calculated declared unit value must be greater than zero.");
  });
});