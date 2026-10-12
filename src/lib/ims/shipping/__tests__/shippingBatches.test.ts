import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeShippingBatchMembership } from "../shippingBatches";
import {
  getShippingBatchId, shippingBatchMembershipIssue, validateShippingBatchMembershipInput,
  type ShippingBatchMembershipInput,
} from "../shippingBatchTypes";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock("@/services/IMSMySQLService", () => ({ getIMSPool: () => ({ getConnection: async () => mocks }) }));
const shipment = (id: number, changes: Record<string, unknown> = {}) => ({
  id, so_id: id + 100, operation_key: `legacy:${id}`, revision: 2, status: "label_ready",
  manifest_id: null, ims_fulfilled_at: null, membership_id: null, batch_key: null, batch_revision: null,
  parcel_count: 1, invalid_parcel_count: 0,
  ...changes,
});
const label = (id: number, shipmentId: number, changes: Record<string, unknown> = {}) => ({
  id, shipment_id: shipmentId, provider_request_id: "request-1", label_url: "https://labels.invalid/shared.pdf", ...changes,
});
const input = (ids = [1], batchId: string | null = null): ShippingBatchMembershipInput => ({
  shipmentIds: ids.map((shipmentId) => ({ shipmentId, expectedBatchRevision: 0, expectedShipmentRevision: 2 })),
  batchId,
});
function setup(shipments: unknown[], labels: unknown[] = []) {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT shipment.id")) return [shipments, []];
    if (sql.includes("SELECT label.id")) return [labels, []];
    return [{ affectedRows: 1 }, []];
  });
}
const writes = () => mocks.execute.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));

beforeEach(() => {
  vi.clearAllMocks();
  setup([shipment(1), shipment(2)]);
});

describe("shipping batch policy and migration compatibility", () => {
  it("uses legacy operation grouping only for missing rows, not explicit null", () => {
    expect(getShippingBatchId("batch:123")).toBe("batch");
    expect(getShippingBatchId("batch:123", { batch_key: null })).toBeNull();
    expect(getShippingBatchId("original:123", { batch_key: "destination" })).toBe("destination");
    expect(getShippingBatchId("batch:word")).toBe("batch:word");
  });
  it.each(["amending", "amendment_unknown", "submitting", "submission_unknown", "label_submitting",
    "label_pending", "label_unknown", "ims_fulfilled", "channel_pending", "complete", "manifested", "voided"])(
    "blocks unsafe state %s", (status) => expect(shippingBatchMembershipIssue({ status })).not.toBe(""),
  );
  it("validates exact object-array IDs, revisions, uniqueness, bounds and destination", () => {
    expect(() => validateShippingBatchMembershipInput(input())).not.toThrow();
    for (const value of [
      {}, { ...input(), shipmentIds: [1] }, { ...input(), shipmentIds: [] },
      input(Array.from({ length: 51 }, (_, id) => id + 1)), input([1, 1]),
      input([0]), input([-1]), input([1.5]),
      { ...input(), batchId: " " }, { ...input(), batchId: 1 },
      { ...input(), createBatch: true }, { ...input(), createBatch: "true" },
      { ...input(), shipmentIds: [{ shipmentId: 1, expectedBatchRevision: -1, expectedShipmentRevision: 2 }] },
      { ...input(), shipmentIds: [{ shipmentId: 1, expectedBatchRevision: 0, expectedShipmentRevision: "2" }] },
    ]) expect(() => validateShippingBatchMembershipInput(value)).toThrow();
  });
  it("creates only empty membership structure with no backfill on repeat migrations", () => {
    const schema = readFileSync(resolve("scripts", "ims-schema.sql"), "utf8");
    const migration = readFileSync(resolve("scripts", "catchup-schema-all-tenants.mjs"), "utf8");
    const contract = readFileSync(resolve("src", "lib", "ims", "schemaContract.ts"), "utf8");
    for (const source of [schema, migration]) {
      expect(source).toContain("CREATE TABLE IF NOT EXISTS ims_shipping_batch_memberships");
      expect(source).toContain("PRIMARY KEY (business_id, shipment_id)");
      expect(source).toContain("ON DELETE CASCADE");
      expect(source).not.toMatch(/INSERT(?: IGNORE)? INTO ims_shipping_batch_memberships/i);
    }
    expect(contract).toContain("ims_shipping_batch_memberships: ['business_id', 'shipment_id', 'batch_key', 'revision']");
  });
});

describe("atomic tenant-scoped batch membership", () => {
  it.each([{ parcel_count: 0 }, { invalid_parcel_count: 1 }])("blocks batching orders without saved measurements: %j", async (changes) => {
    setup([shipment(1, changes)]);
    await expect(changeShippingBatchMembership("tenant-a", { ...input([1], "new"), createBatch: true })).rejects.toThrow("Save valid parcel dimensions");
    expect(writes()).toHaveLength(0);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it("detaches legacy membership without editing any shipping details, postage or stock", async () => {
    expect(await changeShippingBatchMembership("tenant-a", input())).toEqual({
      affectedShipmentIds: [1], requiresFreshLabels: false,
    });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toEqual([expect.stringContaining("INSERT INTO ims_shipping_batch_memberships"), ["tenant-a", 1, null]]);
    expect(mocks.execute.mock.calls[0][0]).toContain("ORDER BY shipment.id FOR UPDATE");
    expect(mocks.execute.mock.calls.every(([, values]) => values[0] === "tenant-a")).toBe(true);
    const source = readFileSync(resolve("src", "lib", "ims", "shipping", "shippingBatches.ts"), "utf8");
    expect(source).not.toMatch(/carrier(s)?\/|createShipment|updateShipment|cancelShipment|dispatchShipment|ims_stock|ims_shipping_parcel_items/);
  });
  it("preserves individual PDFs when moving to an existing destination", async () => {
    setup([shipment(1), shipment(2, { operation_key: "destination:2" })], [
      label(11, 1, { provider_request_id: "individual", label_url: "https://labels.invalid/individual.pdf" }),
      label(12, 2),
    ]);
    expect((await changeShippingBatchMembership("tenant-a", input([1], "destination"))).requiresFreshLabels).toBe(false);
    expect(writes()).toHaveLength(1);
  });
  it("can create a new batch or reattach an explicitly unbatched shipment", async () => {
    setup([shipment(1, { membership_id: 1, batch_revision: 4 }), shipment(2)]);
    const body = { ...input([1], "new-batch"), createBatch: true };
    body.shipmentIds[0].expectedBatchRevision = 4;
    await changeShippingBatchMembership("tenant-a", body);
    expect(writes()[0][1]).toEqual(["tenant-a", 1, "new-batch"]);
  });
  it("does not bump membership or shipment revision on an authoritative no-op", async () => {
    setup([shipment(1, { membership_id: 1, batch_revision: 1 })]);
    const body = input();
    body.shipmentIds[0].expectedBatchRevision = 1;
    expect((await changeShippingBatchMembership("tenant-a", body)).requiresFreshLabels).toBe(false);
    expect(writes()).toEqual([]);
  });
  it.each([
    { revision: 3 }, { membership_id: 2, batch_revision: 1 },
    { manifest_id: 7 }, { ims_fulfilled_at: "2026-10-12" }, { status: "label_unknown" },
  ])("rolls back the entire selected bulk operation on conflict %j", async (change) => {
    setup([shipment(1), shipment(2, change)]);
    await expect(changeShippingBatchMembership("tenant-a", input([1, 2]))).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("rejects unknown ownership and missing destination with 404", async () => {
    await expect(changeShippingBatchMembership("tenant-a", input([99]))).rejects.toMatchObject({ status: 404 });
    await expect(changeShippingBatchMembership("tenant-a", input([1], "missing"))).rejects.toMatchObject({ status: 404 });
    expect(writes()).toEqual([]);
  });
  it("supersedes source shared PDFs and bumps all affected shipment revisions once", async () => {
    setup([shipment(1), shipment(2), shipment(3)], [label(11, 1), label(12, 2),
      label(13, 3, { provider_request_id: "individual", label_url: "https://labels.invalid/individual.pdf" })]);
    expect(await changeShippingBatchMembership("tenant-a", input())).toEqual({
      affectedShipmentIds: [1, 2], requiresFreshLabels: true,
    });
    expect(writes()).toHaveLength(3);
    expect(writes()[0][1]).toEqual(["tenant-a", 11, 12]);
    expect(writes()[1][1]).toEqual(["tenant-a", 1, 2]);
    expect(writes()[1][0]).toContain("revision = revision + 1");
    expect(writes().map(([sql]) => sql).join("\n")).not.toMatch(/charged_cost\s*=|quoted_cost\s*=|provider_shipment_id\s*=|recipient_json\s*=|ims_stock/);
  });
  it("preserves a shared PDF when all members move together to one destination", async () => {
    setup([shipment(1), shipment(2)], [label(11, 1), label(12, 2)]);
    const body = { ...input([1, 2], "new"), createBatch: true };
    expect((await changeShippingBatchMembership("tenant-a", body)).requiresFreshLabels).toBe(false);
    expect(writes()).toHaveLength(2);
  });
  it("refreshes destination shared PDFs that also contain a member in another group", async () => {
    setup([shipment(1), shipment(2, { operation_key: "destination:2" }), shipment(3, { operation_key: "other:3" })],
      [label(11, 1), label(12, 2), label(13, 3)]);
    expect(await changeShippingBatchMembership("tenant-a", input([1], "destination"))).toEqual({
      affectedShipmentIds: [1, 2, 3], requiresFreshLabels: true,
    });
  });
  it("detects shared URL even when request identifiers differ", async () => {
    setup([shipment(1), shipment(2)], [label(11, 1), label(12, 2, { provider_request_id: "different" })]);
    expect((await changeShippingBatchMembership("tenant-a", input())).requiresFreshLabels).toBe(true);
  });
  it("includes the complete connected shared-document group across both URLs and request IDs", async () => {
    setup([shipment(1), shipment(2), shipment(3)], [
      label(11, 1, { label_url: "https://labels.invalid/first.pdf" }),
      label(12, 2, { label_url: "https://labels.invalid/second.pdf" }),
      label(13, 3, { provider_request_id: "request-2", label_url: "https://labels.invalid/second.pdf" }),
    ]);
    expect(await changeShippingBatchMembership("tenant-a", input())).toEqual({
      affectedShipmentIds: [1, 2, 3], requiresFreshLabels: true,
    });
    expect(writes()[0][1]).toEqual(["tenant-a", 11, 12, 13]);
  });
  it.each([{ manifest_id: 8 }, { ims_fulfilled_at: "2026-10-12" }, { status: "amending" }, { status: "label_pending" }])(
    "rejects all changes if an affected shared sibling is unsafe %j", async (change) => {
      setup([shipment(1), shipment(2, change)], [label(11, 1), label(12, 2)]);
      await expect(changeShippingBatchMembership("tenant-a", input())).rejects.toMatchObject({ status: 409 });
      expect(writes()).toEqual([]);
    },
  );
  it("rolls back label superseding and metadata together when SQL fails", async () => {
    setup([shipment(1), shipment(2)], [label(11, 1), label(12, 2)]);
    const implementation = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (sql, values) => {
      if (sql.includes("INSERT INTO ims_shipping_batch_memberships")) throw new Error("SQL failure");
      return implementation(sql, values);
    });
    await expect(changeShippingBatchMembership("tenant-a", input())).rejects.toThrow("SQL failure");
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
