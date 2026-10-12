import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  getLabel: vi.fn(),
  createLabels: vi.fn(),
  getRates: vi.fn(),
}));

vi.mock("@/services/IMSMySQLService", () => ({
  imsQuery: mocks.query,
  imsExecute: mocks.execute,
  getIMSPool: vi.fn(),
}));
vi.mock("../shippingSettingsRepository", () => ({
  ShippingSettingsRepository: {
    getAccountCredentials: async () => ({
      accountNumber: "test-account", apiKey: "test-key", password: "test-password",
    }),
  },
}));
vi.mock("../carriers/auspostEparcel/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../carriers/auspostEparcel/client")>();
  return {
    ...original,
    AusPostEparcelClient: class {
      getLabel = mocks.getLabel;
      createLabels = mocks.createLabels;
      getRates = mocks.getRates;
    },
  };
});

import { submitShippingDraftsAndCreateLabels } from "../shippingSubmission";

const shipment = {
  id: 91, so_id: 12, so_number: "SO-12", channel_order_number: "#12",
  carrier_account_id: 1, provider: "auspost_eparcel",
  status: "carrier_created", provider_shipment_id: "existing-shipment",
  provider_reference: "SO-12", service_code: "T28", service_name: "Parcel Post",
  quoted_cost: 12.5, sender_json: {}, recipient_json: {},
  is_international: 0, customs_json: null, revision: 2,
  manifest_id: null, ims_fulfilled_at: null,
};
const response = {
  labels: [{ request_id: "new-request", status: "AVAILABLE", url: "https://labels.example/current.pdf" }],
};

describe("shipping label submission revisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN ims_sales_orders")) return [shipment];
      if (sql.includes("FROM ims_shipping_parcels"))
        return [{ id: 101, parcel_number: 1, length_mm: 200, width_mm: 150, height_mm: 100, weight_kg: 1 }];
      if (sql.includes("FROM ims_shipping_labels")) return [];
      if (sql.includes("SELECT charged_cost")) return [{ charged_cost: 12.5 }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.createLabels.mockResolvedValue(response);
    mocks.getLabel.mockResolvedValue(response);
  });

  it("generates labels for the current revision without creating new postage", async () => {
    const result = await submitShippingDraftsAndCreateLabels({
      businessId: "tenant-one", shipmentIds: [91],
    });
    expect(result[0].providerShipmentId).toBe("existing-shipment");
    expect(mocks.getRates).not.toHaveBeenCalled();
    expect(mocks.createLabels).toHaveBeenCalledOnce();
    const labelQuery = mocks.query.mock.calls.find(([sql]) => sql.includes("FROM ims_shipping_labels"));
    expect(labelQuery?.[0]).toContain("shipment_revision = ?");
    expect(labelQuery?.[0]).toContain("status <> 'superseded'");
    expect(labelQuery?.[1]).toEqual(["tenant-one", 91, 2]);
    const insert = mocks.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO ims_shipping_labels"));
    expect(insert?.[0]).toContain("shipment_revision");
    expect(insert?.[1]).toEqual(["tenant-one", 91, "new-request", "A4-4pp", 2]);
    const persisted = mocks.execute.mock.calls.find(([sql]) => sql.includes("JOIN ims_shipping_shipments shipment"));
    expect(persisted?.[0]).toContain("shipment.revision = ?");
    expect(persisted?.[1].slice(-2)).toEqual([2, 2]);
  });

  it("does not make an old pending label ready when an amendment has changed its revision", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN ims_sales_orders")) return [{ ...shipment, status: "label_pending" }];
      if (sql.includes("FROM ims_shipping_parcels")) return [{ id: 101, parcel_number: 1 }];
      if (sql.includes("FROM ims_shipping_labels"))
        return [{ provider_request_id: "old-request", status: "pending", label_url: null }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(submitShippingDraftsAndCreateLabels({
      businessId: "tenant-one", shipmentIds: [91],
    })).rejects.toThrow("Shipment details changed");
    expect(mocks.getLabel).toHaveBeenCalledWith("old-request");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.createLabels).not.toHaveBeenCalled();
  });

  it("reconciles an unknown label using its recorded request ID without purchasing postage again", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN ims_sales_orders")) return [{ ...shipment, status: "label_unknown" }];
      if (sql.includes("FROM ims_shipping_parcels")) return [{ id: 101, parcel_number: 1 }];
      if (sql.includes("FROM ims_shipping_labels"))
        return [{ provider_request_id: "existing-request", status: "pending", label_url: null }];
      if (sql.includes("SELECT charged_cost")) return [{ charged_cost: 12.5 }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getLabel.mockResolvedValue({
      labels: [{ request_id: "existing-request", status: "AVAILABLE", url: "https://labels.example/reconciled.pdf" }],
    });
    const result = await submitShippingDraftsAndCreateLabels({
      businessId: "tenant-one", shipmentIds: [91],
    });
    expect(result[0].status).toBe("label_ready");
    expect(mocks.getLabel).toHaveBeenCalledWith("existing-request");
    expect(mocks.createLabels).not.toHaveBeenCalled();
    expect(mocks.getRates).not.toHaveBeenCalled();
  });

  it("never repeats label creation when the unknown request has no recoverable identity", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN ims_sales_orders")) return [{ ...shipment, status: "label_unknown" }];
      if (sql.includes("FROM ims_shipping_parcels")) return [{ id: 101, parcel_number: 1 }];
      if (sql.includes("FROM ims_shipping_labels")) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(submitShippingDraftsAndCreateLabels({
      businessId: "tenant-one", shipmentIds: [91],
    })).rejects.toThrow("label request outcome is unknown");
    expect(mocks.getLabel).not.toHaveBeenCalled();
    expect(mocks.createLabels).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["amending", "amendment_unknown", "voided", "complete"])(
    "does not call the carrier for a shipment in %s state",
    async (status) => {
      mocks.query.mockResolvedValue([{ ...shipment, status }]);
      await expect(submitShippingDraftsAndCreateLabels({
        businessId: "tenant-one", shipmentIds: [91],
      })).rejects.toThrow("not ready for label generation");
      expect(mocks.createLabels).not.toHaveBeenCalled();
      expect(mocks.getLabel).not.toHaveBeenCalled();
    },
  );
});
