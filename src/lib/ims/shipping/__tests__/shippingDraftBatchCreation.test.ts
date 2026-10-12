import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShippingDrafts, type ShippingDraftInput } from "../shippingDrafts";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  order: vi.fn(), location: vi.fn(),
}));
vi.mock("@/services/IMSMySQLService", () => ({ getIMSPool: () => ({ getConnection: async () => mocks }) }));
vi.mock("@/lib/ims/ImsRepository", () => ({ ImsSORepo: { get: mocks.order }, ImsLocationsRepo: { get: mocks.location } }));
const input = (): ShippingDraftInput => ({
  businessId: "tenant-a", operationKey: "creation", carrierAccountId: 9,
  shipments: [{
    soId: 10,
    service: { serviceCode: "EXP", serviceName: "Express", total: 11, totalExGst: 10, gst: 1 },
    parcels: [{
      parcelNumber: 1, lengthMm: 200, widthMm: 100, heightMm: 100, weightKg: 1,
      allocations: [{ soItemId: 5, quantity: 2 }],
    }],
  }],
});
const shipment = (changes: Record<string, unknown> = {}) => ({
  id: 2, so_id: 20, operation_key: "destination:20", revision: 0, status: "draft",
  manifest_id: null, ims_fulfilled_at: null, membership_id: null, batch_key: null, batch_revision: null, ...changes,
});
function setup(shipments: unknown[] = [], existingHash?: string) {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM ims_shipping_carrier_accounts")) return [[{ id: 9, provider: "auspost_eparcel", dispatch_location_id: 3 }], []];
    if (sql.includes("SELECT id, status FROM ims_sales_orders")) return [[{ id: 10, status: "confirmed" }], []];
    if (sql.includes("SELECT shipment.id")) return [shipments, []];
    if (sql.includes("INSERT IGNORE INTO ims_shipping_shipments")) return [{ insertId: existingHash ? 0 : 1 }, []];
    if (sql.includes("SELECT id, request_hash")) return [[{ id: 1, request_hash: existingHash }], []];
    if (sql.includes("INSERT INTO ims_shipping_parcels")) return [{ insertId: 3 }, []];
    return [{ affectedRows: 1 }, []];
  });
}
const writes = () => mocks.execute.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.mockResolvedValue({
    id: 10, so_number: "SO10", status: "confirmed", so_type: "online", location_id: 3, customer_name: "Buyer",
    delivery_address: "1 Main St", delivery_suburb: "Melbourne", delivery_state: "VIC", delivery_postcode: "3000", delivery_country: "AU",
    items: [{ id: 5, qty_ordered: 2, qty_fulfilled: 0 }],
  });
  mocks.location.mockResolvedValue({
    name: "Store", address: "2 Main St", city: "Melbourne", state: "VIC", postcode: "3000", country: "AU",
  });
  setup();
});
describe("draft creation membership and duplicate purchase protection", () => {
  it("rejects malformed order entries without accessing the database", async () => {
    await expect(createShippingDrafts({ ...input(), shipments: [null] } as unknown as ShippingDraftInput))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("assigns a new batch independently from immutable operation and provider references", async () => {
    expect(await createShippingDrafts(input())).toEqual([{ soId: 10, shipmentId: 1 }]);
    const membership = writes().find(([sql]) => sql.includes("ims_shipping_batch_memberships"));
    expect(membership?.[1]).toEqual(["tenant-a", 1, "creation"]);
    const creation = writes().find(([sql]) => sql.includes("ims_shipping_shipments"));
    expect(creation?.[1][1]).toBe("creation:10");
    expect(mocks.commit).toHaveBeenCalledOnce();
    const orderLock = mocks.execute.mock.calls.findIndex(([sql]) => sql.includes("ORDER BY id FOR UPDATE"));
    const shipmentInsert = mocks.execute.mock.calls.findIndex(([sql]) => sql.includes("INSERT IGNORE"));
    expect(orderLock).toBeGreaterThanOrEqual(0);
    expect(orderLock).toBeLessThan(shipmentInsert);
    expect(writes().map(([sql]) => sql).join("\n")).not.toMatch(/ims_stock|UPDATE ims_sales_orders|UPDATE ims_shipping_shipments/);
  });
  it("adds fresh orders to an existing batch in the same transaction", async () => {
    setup([shipment()]);
    await createShippingDrafts({ ...input(), batchId: "destination" });
    expect(writes().find(([sql]) => sql.includes("ims_shipping_batch_memberships"))?.[1]).toEqual(["tenant-a", 1, "destination"]);
    expect(writes().find(([sql]) => sql.includes("ims_shipping_shipments"))?.[1][1]).toBe("creation:10");
  });
  it("rejects a missing destination before writing any draft", async () => {
    await expect(createShippingDrafts({ ...input(), batchId: "missing" })).rejects.toMatchObject({ status: 404 });
    expect(writes()).toEqual([]);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it.each(["draft", "label_ready", "submission_unknown", "label_unknown", "amending", "amendment_unknown"])(
    "rejects a second active %s shipment with another operation key under the SO lock", async (status) => {
      setup([shipment({ so_id: 10, status })]);
      await expect(createShippingDrafts(input())).rejects.toMatchObject({ status: 409 });
      expect(writes()).toEqual([]);
      expect(mocks.commit).not.toHaveBeenCalled();
    },
  );
  it("allows a voided or already-dispatched prior shipment", async () => {
    setup([shipment({ so_id: 10, status: "voided" }), shipment({ so_id: 10, ims_fulfilled_at: "2026-10-12" })]);
    expect(await createShippingDrafts(input())).toEqual([{ soId: 10, shipmentId: 1 }]);
  });
  it("retries the same request without moving existing membership even if destination differs or disappeared", async () => {
    const body = input();
    const hash = createHash("sha256").update(JSON.stringify({
      shipment: body.shipments[0], service: body.shipments[0].service, customs: null,
    })).digest("hex");
    setup([shipment({ id: 1, so_id: 10, operation_key: "creation:10", membership_id: 1, batch_revision: 5, batch_key: null })], hash);
    expect(await createShippingDrafts({ ...body, batchId: "missing-different-destination" })).toEqual([{ soId: 10, shipmentId: 1 }]);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toContain("INSERT IGNORE INTO ims_shipping_shipments");
  });
  it("rolls back draft inserts if membership storage fails", async () => {
    const implementation = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (sql, values) => {
      if (sql.includes("INSERT INTO ims_shipping_batch_memberships")) throw new Error("Membership failure");
      return implementation(sql, values);
    });
    await expect(createShippingDrafts(input())).rejects.toThrow("Membership failure");
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
