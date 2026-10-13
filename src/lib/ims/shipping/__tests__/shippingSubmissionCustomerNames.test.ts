import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitShippingDraftsAndCreateLabels } from "../shippingSubmission";
import type { CarrierAddress } from "../carriers/types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), name: vi.fn(),
  rates: vi.fn(), create: vi.fn(), international: vi.fn(), labels: vi.fn(), getLabel: vi.fn(),
}));
vi.mock("@/services/IMSMySQLService", () => ({
  imsQuery: mocks.query, imsExecute: mocks.execute,
  getIMSPool: () => ({ getConnection: async () => ({
    execute: mocks.transaction, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  }) }),
}));
vi.mock("../shippingCustomerNames", async importOriginal => ({
  ...await importOriginal<typeof import("../shippingCustomerNames")>(), resolveShippingOrderCustomerName: mocks.name,
}));
vi.mock("../shippingSettingsRepository", () => ({
  ShippingSettingsRepository: { getAccountCredentials: async () => ({ accountNumber: "test", apiKey: "test", password: "test" }) },
}));
vi.mock("../carriers/auspostEparcel/client", async importOriginal => ({
  ...await importOriginal<typeof import("../carriers/auspostEparcel/client")>(),
  AusPostEparcelClient: class {
    getRates = mocks.rates;
    createDomesticShipments = mocks.create;
    createInternationalShipments = mocks.international;
    createLabels = mocks.labels;
    getLabel = mocks.getLabel;
  },
}));

let shipment: {
  id: number; so_id: number; so_number: string; channel_order_number: string;
  carrier_account_id: number; provider: string; status: string; provider_shipment_id: string | null;
  provider_reference: string; service_code: string; service_name: string; quoted_cost: number;
  sender_json: CarrierAddress; recipient_json: CarrierAddress; is_international: number;
  customs_json: null; revision: number;
};
beforeEach(() => {
  vi.clearAllMocks();
  const address = { name: "Warehouse", lines: ["1 Test St"], suburb: "Sydney", state: "NSW", postcode: "2000", country: "AU" };
  shipment = {
    id: 91, so_id: 12, so_number: "SO-12", channel_order_number: "#12",
    carrier_account_id: 1, provider: "auspost_eparcel", status: "draft", provider_shipment_id: null,
    provider_reference: "SO-12-reference", service_code: "T28", service_name: "Parcel Post", quoted_cost: 11,
    sender_json: address, recipient_json: { ...address, name: "Online Customer", email: "recipient@example.invalid" },
    is_international: 0, customs_json: null, revision: 2,
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("JOIN ims_sales_orders")) return [{ ...shipment }];
    if (sql.includes("FROM ims_shipping_parcels")) return [{ id: 101, parcel_number: 1, length_mm: 200, width_mm: 150, height_mm: 100, weight_kg: 1 }];
    if (sql.includes("FROM ims_shipping_labels")) return [];
    if (sql.includes("SELECT charged_cost")) return [{ charged_cost: 11 }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  mocks.execute.mockImplementation(async (sql: string, parameters: unknown[]) => {
    if (sql.includes("recipient_json = ?")) {
      shipment.recipient_json = JSON.parse(String(parameters[0]));
      shipment.revision++;
    }
    return { affectedRows: 1 };
  });
  mocks.transaction.mockResolvedValue([{ affectedRows: 1 }]);
  mocks.name.mockResolvedValue({ name: "Order Recipient", issue: null });
  mocks.rates.mockResolvedValue([[{ serviceCode: "T28", serviceName: "Parcel Post", total: 11, totalExGst: 10, gst: 1 }]]);
  mocks.create.mockResolvedValue({ shipments: [{ shipment_id: "carrier-91", shipment_summary: { total_cost: 11 } }] });
  mocks.labels.mockResolvedValue({ labels: [{ request_id: "labels-91", status: "AVAILABLE", url: "https://example.invalid/labels.pdf" }] });
  mocks.getLabel.mockResolvedValue({ labels: [{ request_id: "existing-request", status: "AVAILABLE", url: "https://example.invalid/original-label.pdf" }] });
});

describe("carrier recipient names at label creation", () => {
  it("repairs an old unpurchased draft atomically and sends the resolved name to the carrier", async () => {
    await submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] });
    expect(mocks.name).toHaveBeenCalledWith("tenant-a", 12, "Online Customer");
    expect(mocks.rates.mock.calls[0][0].to.name).toBe("Order Recipient");
    expect(mocks.create.mock.calls[0][0].shipments[0].to.name).toBe("Order Recipient");
    expect(shipment.recipient_json).toMatchObject({ name: "Order Recipient", email: "recipient@example.invalid" });
    const claim = mocks.execute.mock.calls.find(([sql]) => sql.includes("recipient_json = ?"));
    expect(claim?.[0]).toContain("revision = revision + 1");
    expect(claim?.[1].slice(-3)).toEqual(["tenant-a", 91, 2]);
    const label = mocks.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO ims_shipping_labels"));
    expect(label?.[1].at(-1)).toBe(3);
    expect(mocks.international).not.toHaveBeenCalled();
  });

  it("blocks purchase if the order-specific lookup cannot resolve the generic recipient", async () => {
    mocks.name.mockResolvedValue({ name: null, issue: "Unable to load the customer name." });
    await expect(submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] })).rejects.toThrow("actual delivery recipient");
    expect(mocks.rates).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("requires explicit editing of purchased generic recipients rather than silently changing postage", async () => {
    shipment.provider_shipment_id = "already-purchased";
    shipment.status = "label_ready";
    await expect(submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] })).rejects.toThrow("edit shipment details");
    expect(mocks.name).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not overwrite a specific manual recipient", async () => {
    shipment.recipient_json = { ...shipment.recipient_json, name: "Gift Recipient" };
    await submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] });
    expect(mocks.name).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].shipments[0].to.name).toBe("Gift Recipient");
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("recipient_json = ?"))).toBe(false);
  });

  it.each(["label_pending", "label_unknown"])("still reconciles an existing %s label request before the recipient can be amended", async status => {
    shipment.provider_shipment_id = "already-purchased";
    shipment.status = status;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN ims_sales_orders")) return [{ ...shipment }];
      if (sql.includes("FROM ims_shipping_parcels")) return [{ id: 101, parcel_number: 1 }];
      if (sql.includes("FROM ims_shipping_labels")) return [{ provider_request_id: "existing-request", status: "pending", label_url: null }];
      if (sql.includes("SELECT charged_cost")) return [{ charged_cost: 11 }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] });
    expect(result[0].status).toBe("label_ready");
    expect(mocks.getLabel).toHaveBeenCalledWith("existing-request");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.name).not.toHaveBeenCalled();
    expect(shipment.recipient_json.name).toBe("Online Customer");
  });

  it("does not purchase when the revision-protected recipient update loses a race", async () => {
    mocks.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(submitShippingDraftsAndCreateLabels({ businessId: "tenant-a", shipmentIds: [91] })).rejects.toThrow("already being submitted");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(shipment.recipient_json.name).toBe("Online Customer");
  });
});
