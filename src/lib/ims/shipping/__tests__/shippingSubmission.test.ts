import { describe, expect, it } from "vitest";

import {
  buildAusPostDomesticShipment,
  buildAusPostInternationalShipment,
  getAusPostLabelPreference,
  groupShipmentsByLabelPreference,
  validateSelectedShippingRate,
} from "../shippingSubmission";

const shipment = {
  id: 91,
  so_id: 12,
  so_number: "ONL-20260908-528728",
  channel_order_number: "#47908",
  carrier_account_id: 1,
  provider: "auspost_eparcel",
  status: "draft",
  provider_shipment_id: null,
  provider_reference: "ONL-20260908-528728-operation",
  service_code: "T28",
  service_name: "Parcel Post",
  quoted_cost: 12.5,
  sender_json: JSON.stringify({
    name: "Warehouse",
    lines: ["1 Main St"],
    suburb: "Sydney",
    state: "NSW",
    postcode: "2000",
    country: "AU",
  }),
  recipient_json: {
    name: "Buyer",
    lines: ["2 High St"],
    suburb: "Melbourne",
    state: "VIC",
    postcode: "3000",
    country: "AU",
    email: "buyer@example.com",
  },
  is_international: 0,
  customs_json: null,
};

describe("Australia Post shipment submission", () => {
  it("maps a saved shipment and parcels to the domestic shipment contract", () => {
    expect(
      buildAusPostDomesticShipment(shipment, [
        {
          id: 101,
          parcel_number: 1,
          length_mm: 205,
          width_mm: 150,
          height_mm: 99,
          weight_kg: 1.25,
        },
      ]),
    ).toEqual({
      shipment_reference: "ONL-20260908-528728-operation",
      customer_reference_1: "ONL-20260908-528728",
      customer_reference_2: "#47908",
      contains_s8_goods: false,
      from: {
        name: "Warehouse",
        lines: ["1 Main St"],
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
      },
      to: {
        name: "Buyer",
        lines: ["2 High St"],
        suburb: "Melbourne",
        state: "VIC",
        postcode: "3000",
        email: "buyer@example.com",
      },
      items: [
        {
          item_reference: "ONL-20260908-528728 #47908 P1",
          product_id: "T28",
          length: 20.5,
          width: 15,
          height: 9.9,
          weight: 1.25,
          authority_to_leave: false,
          allow_partial_delivery: true,
        },
      ],
    });
  });

  it("uses carrier-supported compact A4 layouts for Parcel and Express Post", () => {
    expect(getAusPostLabelPreference(false, "Parcel Post")).toEqual({
      group: "Parcel Post",
      layout: "A4-4pp",
    });
    expect(getAusPostLabelPreference(false, "Express Post")).toEqual({
      group: "Express Post",
      layout: "A4-3pp",
    });
    expect(getAusPostLabelPreference(true, "Express Post International")).toEqual({
      group: "International",
      layout: "A4-1pp",
    });
  });

  it("separates Parcel Post and Express Post into different label requests", () => {
    const groups = groupShipmentsByLabelPreference([
      { id: 1, service_name: "Parcel Post", is_international: 0 },
      { id: 2, service_name: "Express Post", is_international: 0 },
      { id: 3, service_name: "Parcel Post + Signature", is_international: 0 },
      { id: 4, service_name: "Express Post International", is_international: 1 },
    ]);

    expect(groups).toEqual([
      {
        preference: { group: "Parcel Post", layout: "A4-4pp" },
        shipments: [
          { id: 1, service_name: "Parcel Post", is_international: 0 },
          { id: 3, service_name: "Parcel Post + Signature", is_international: 0 },
        ],
      },
      {
        preference: { group: "Express Post", layout: "A4-3pp" },
        shipments: [{ id: 2, service_name: "Express Post", is_international: 0 }],
      },
      {
        preference: { group: "International", layout: "A4-1pp" },
        shipments: [{ id: 4, service_name: "Express Post International", is_international: 1 }],
      },
    ]);
  });

  it("maps each persisted parcel customs snapshot to an international shipment", () => {
    expect(buildAusPostInternationalShipment({
      ...shipment,
      service_code: "INT_PARCEL_STD_OWN_PACKAGING",
      service_name: "International Standard",
      is_international: 1,
      recipient_json: {
        name: "Buyer",
        lines: ["2 Queen St"],
        suburb: "Auckland",
        state: "",
        postcode: "1010",
        country: "NZ",
        email: "buyer@example.com",
      },
      customs_json: JSON.stringify({
        exportPurpose: "sale",
        declaredCurrency: "AUD",
        nonSaleValuesConfirmed: true,
        totalValue: 90,
        parcels: [{
          parcelNumber: 1,
          totalValue: 90,
          items: [{
            soItemId: 10,
            productId: "product-1",
            sku: "SHIRT-BLU-M",
            description: "Cotton shirt",
            hsCode: "610510",
            countryOfOrigin: "AU",
            isDangerousOrRestricted: false,
            quantity: 1,
            unitValue: 90,
            totalValue: 90,
            weightKg: 0.2,
          }],
        }],
      }),
    }, [{
      id: 101,
      parcel_number: 1,
      length_mm: 205,
      width_mm: 150,
      height_mm: 99,
      weight_kg: 1.25,
    }])).toEqual({
      shipment_reference: "ONL-20260908-528728-operation",
      customer_reference_1: "ONL-20260908-528728",
      customer_reference_2: "#47908",
      from: {
        name: "Warehouse",
        lines: ["1 Main St"],
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
      },
      to: {
        name: "Buyer",
        lines: ["2 Queen St"],
        suburb: "Auckland",
        postcode: "1010",
        country: "NZ",
        email: "buyer@example.com",
      },
      items: [{
        classification_type: "SALE_OF_GOODS",
        commercial_value: true,
        landed_costs_payer: "RECEIVER_PAYS",
        item_contents: [{
          country_of_origin: "AU",
          description: "Cotton shirt",
          sku: "SHIRT-BLU-M",
          quantity: 1,
          tariff_code: "610510",
          value: 90,
          weight: 0.2,
          item_contents_reference: "ONL-20260908-528728 #47908 P1-C1",
        }],
        item_description: "Cotton shirt",
        item_reference: "ONL-20260908-528728 #47908 P1",
        length: 20.5,
        height: 9.9,
        width: 15,
        weight: 1.25,
        product_id: "INT_PARCEL_STD_OWN_PACKAGING",
      }],
    });
  });

  it("rejects dangerous goods from a persisted customs snapshot", () => {
    const internationalShipment = {
      ...shipment,
      is_international: 1,
      recipient_json: { ...shipment.recipient_json, country: "NZ" },
      customs_json: {
        exportPurpose: "gift" as const,
        declaredCurrency: "AUD" as const,
        nonSaleValuesConfirmed: true,
        totalValue: 10,
        parcels: [{
          parcelNumber: 1,
          totalValue: 10,
          items: [{
            soItemId: 10, productId: "product-1", sku: "SKU-1", description: "Sample",
            hsCode: "123456", countryOfOrigin: "AU", isDangerousOrRestricted: true as const,
            quantity: 1, unitValue: 10, totalValue: 10, weightKg: 0.1,
          }],
        }],
      },
    };
    expect(() => buildAusPostInternationalShipment(internationalShipment, [{
      id: 101, parcel_number: 1, length_mm: 100, width_mm: 100, height_mm: 100, weight_kg: 0.2,
    }])).toThrow("dangerous or restricted goods");
  });

  it("rejects an incomplete persisted customs snapshot before carrier submission", () => {
    expect(() => buildAusPostInternationalShipment({
      ...shipment,
      is_international: 1,
      recipient_json: { ...shipment.recipient_json, country: "NZ" },
      customs_json: null,
    }, [{
      id: 101, parcel_number: 1, length_mm: 100, width_mm: 100, height_mm: 100, weight_kg: 0.2,
    }])).toThrow("saved customs declaration is required");
  });

  it("requires the selected service and reviewed price to match a live carrier quote", () => {
    expect(() =>
      validateSelectedShippingRate(shipment, [
        { serviceCode: "T28", total: 12.5 },
      ]),
    ).not.toThrow();
    expect(() =>
      validateSelectedShippingRate(shipment, [
        { serviceCode: "T28", total: 13 },
      ]),
    ).toThrow("shipping price changed");
    expect(() =>
      validateSelectedShippingRate(shipment, [
        { serviceCode: "EXP", total: 12.5 },
      ]),
    ).toThrow("no longer available");
  });
});
