import { describe, expect, it } from "vitest";

import {
  buildCustomsSnapshot,
  calculateSaleDeclaredUnitValue,
  getInternationalRecipientErrors,
  getProductCustomsErrors,
  normalizeHsCode,
  normalizeIsoAlpha2,
  type CustomsSourceLine,
} from "../customs";

const completeLine: CustomsSourceLine = {
  soItemId: 10,
  productId: "product-1",
  sku: "SHIRT-BLU-M",
  description: "Cotton shirt",
  hsCode: "6105.10",
  countryOfOrigin: "au",
  isDangerousOrRestricted: false,
  unitWeightKg: 0.2,
  unitPrice: 110,
  discountPct: 10,
  taxRate: 0.1,
  taxTreatment: "inc_tax",
};

const parcels = [
  {
    parcelNumber: 1,
    lengthMm: 200,
    widthMm: 150,
    heightMm: 100,
    weightKg: 1,
    allocations: [{ soItemId: 10, quantity: 0.5 }],
  },
  {
    parcelNumber: 2,
    lengthMm: 200,
    widthMm: 150,
    heightMm: 100,
    weightKg: 1,
    allocations: [{ soItemId: 10, quantity: 1.5 }],
  },
];

describe("shipping customs", () => {
  it("normalizes ISO alpha-2 and HS values", () => {
    expect(normalizeIsoAlpha2(" nz ")).toBe("NZ");
    expect(normalizeIsoAlpha2("New Zealand")).toBeNull();
    expect(normalizeIsoAlpha2("ZZ")).toBeNull();
    expect(normalizeHsCode(" 6105.10-AB ")).toBe("610510AB");
    expect(normalizeHsCode("12345")).toBeNull();
    expect(normalizeHsCode("A".repeat(15))).toBeNull();
  });

  it("requires the minimum international recipient identity and contact fields", () => {
    expect(getInternationalRecipientErrors({
      country: "NZ",
      name: "Aroha Buyer",
      lines: ["1 Queen Street"],
      email: "",
      phone: "+64 21 123 456",
    })).toEqual([]);
    expect(getInternationalRecipientErrors({
      country: "",
      name: "",
      lines: [],
      email: "",
      phone: "",
    })).toEqual([
      "destination country must be an ISO alpha-2 country code",
      "recipient name is required",
      "recipient street address is required",
      "recipient email or phone is required",
    ]);
  });

  it("applies the SO line discount once and extracts line tax", () => {
    expect(calculateSaleDeclaredUnitValue(completeLine)).toBe(90);
    expect(calculateSaleDeclaredUnitValue({ ...completeLine, discountPct: 0 })).toBe(100);
    expect(calculateSaleDeclaredUnitValue({ ...completeLine, taxRate: 0 })).toBe(99);
    expect(calculateSaleDeclaredUnitValue({ ...completeLine, taxTreatment: "ex_tax" })).toBe(99);
  });

  it("values partial quantities from their parcel allocations", () => {
    const result = buildCustomsSnapshot({
      exportPurpose: "sale",
      lines: [completeLine],
      parcels,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.parcels[0].items[0]).toMatchObject({
      quantity: 0.5,
      unitValue: 90,
      totalValue: 45,
      weightKg: 0.1,
    });
    expect(result.snapshot.parcels[1].totalValue).toBe(135);
    expect(result.snapshot.totalValue).toBe(180);
  });

  it("requires confirmed positive per-line values for non-sale purposes", () => {
    expect(buildCustomsSnapshot({
      exportPurpose: "gift",
      lines: [completeLine],
      parcels,
      nonSaleValues: [{ soItemId: 10, unitValue: 25 }],
      nonSaleValuesConfirmed: false,
    })).toMatchObject({ ok: false, errors: [expect.stringContaining("Confirm")] });

    const result = buildCustomsSnapshot({
      exportPurpose: "return",
      lines: [completeLine],
      parcels,
      nonSaleValues: [{ soItemId: 10, unitValue: 25 }],
      nonSaleValuesConfirmed: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.totalValue).toBe(50);
  });

  it("reports missing customs fields and blocks dangerous or restricted products", () => {
    const errors = getProductCustomsErrors({
      ...completeLine,
      productId: null,
      description: " ",
      hsCode: "123",
      countryOfOrigin: "Australia",
      isDangerousOrRestricted: true,
    });
    expect(errors).toEqual([
      "SHIRT-BLU-M: linked product is required.",
      "SHIRT-BLU-M: customs description is required.",
      "SHIRT-BLU-M: HS code must contain 6 to 14 letters or numbers.",
      "SHIRT-BLU-M: two-letter country of origin is required.",
      "SHIRT-BLU-M: dangerous or restricted goods cannot be shipped.",
    ]);
  });

  it("requires a positive product weight for every customs item", () => {
    expect(getProductCustomsErrors({ ...completeLine, unitWeightKg: null })).toContain(
      "SHIRT-BLU-M: a positive product weight is required.",
    );
  });

  it("does not require customs data for an order line absent from parcel allocations", () => {
    const result = buildCustomsSnapshot({
      exportPurpose: "sale",
      lines: [
        completeLine,
        {
          ...completeLine,
          soItemId: 11,
          productId: null,
          description: null,
          hsCode: null,
          countryOfOrigin: null,
        },
      ],
      parcels,
    });
    expect(result.ok).toBe(true);
  });

  it("returns an immutable snapshot detached from mutable source data", () => {
    const sourceLine = { ...completeLine };
    const sourceParcels = structuredClone(parcels);
    const result = buildCustomsSnapshot({
      exportPurpose: "sale",
      lines: [sourceLine],
      parcels: sourceParcels,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    sourceLine.description = "Changed later";
    sourceParcels[0].allocations[0].quantity = 99;
    expect(result.snapshot.parcels[0].items[0].description).toBe("Cotton shirt");
    expect(result.snapshot.parcels[0].items[0].quantity).toBe(0.5);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.parcels[0].items[0])).toBe(true);
  });
});