import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/ims/shipping/batches/membership/route";
import { GET, POST } from "@/app/api/ims/shipping/drafts/route";
import { ShippingBatchError } from "../shippingBatchTypes";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), context: vi.fn(), change: vi.fn(), drafts: vi.fn(), query: vi.fn(), runtime: vi.fn(), names: vi.fn(),
}));
vi.mock("@/lib/auth/imsSession", () => ({ getImsSession: mocks.session }));
vi.mock("@/lib/db/BusinessRegistry", () => ({ runImsForBusiness: mocks.context }));
vi.mock("../shippingBatches", () => ({ changeShippingBatchMembership: mocks.change }));
vi.mock("../shippingDrafts", () => ({ createShippingDrafts: mocks.drafts }));
vi.mock("@/services/IMSMySQLService", () => ({ imsQuery: mocks.query, imsExecute: vi.fn() }));
vi.mock("@/lib/runtimeIssues", () => ({ reportRuntimeIssue: mocks.runtime }));
vi.mock("../shippingCustomerNames", () => ({ resolveShippingCustomerNames: mocks.names }));
const body = { shipmentIds: [{ shipmentId: 1, expectedBatchRevision: 0, expectedShipmentRevision: 2 }], batchId: null };
const request = (value: unknown = body) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(value) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: "tenant-a", tier: "Retail" });
  mocks.context.mockImplementation(async (_id: string, callback: () => Promise<unknown>) => callback());
  mocks.change.mockResolvedValue({ affectedShipmentIds: [1], requiresFreshLabels: false });
  mocks.drafts.mockResolvedValue([{ soId: 11, shipmentId: 1 }]);
  mocks.names.mockImplementation(async (_businessId: string, rows: Array<{ shipmentId: number; customerName: string | null }>) =>
    new Map(rows.map(row => [row.shipmentId, { name: row.customerName, issue: null }])));
});
describe("shipping batch endpoint contracts", () => {
  it("requires tenant auth and rejects Advisors before parsing or access", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PATCH(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ businessId: "tenant-a", tier: "Advisor" });
    expect((await PATCH(request())).status).toBe(403);
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("binds tenant context explicitly and never accepts a supplied tenant", async () => {
    const response = await PATCH(request({ ...body, businessId: "other" }));
    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith("tenant-a", expect.any(Function));
    expect(mocks.change).toHaveBeenCalledWith("tenant-a", expect.objectContaining(body));
    expect(await response.json()).toEqual({ success: true, data: { affectedShipmentIds: [1], requiresFreshLabels: false } });
  });
  it("rejects malformed JSON and unsafe request shape as 400", async () => {
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: "{" }))).status).toBe(400);
    expect((await PATCH(request({ ...body, shipmentIds: [1] }))).status).toBe(400);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it.each([400, 403, 404, 409] as const)("returns explicit expected %s without reporting an operational failure", async (status) => {
    mocks.change.mockRejectedValue(new ShippingBatchError("Expected refusal.", status));
    expect((await PATCH(request())).status).toBe(status);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("reports only safe tenant context for unexpected failures", async () => {
    mocks.change.mockRejectedValue(new Error("secret raw payload"));
    expect((await PATCH(request())).status).toBe(500);
    expect(mocks.runtime).toHaveBeenCalledWith(expect.objectContaining({
      businessId: "tenant-a", context: { errorType: "Error" }, reference: { type: "shipping_batch", id: "membership" },
    }));
    expect(JSON.stringify(mocks.runtime.mock.calls)).not.toContain("secret raw payload");
  });
  it("preserves draft POST output and passes optional destination unchanged", async () => {
    const response = await POST(request({ operationKey: "request-1", carrierAccountId: 9, shipments: [], batchId: "destination", businessId: "other" }));
    expect(await response.json()).toEqual({ success: true, data: [{ soId: 11, shipmentId: 1 }] });
    expect(mocks.drafts).toHaveBeenCalledWith({
      operationKey: "request-1", carrierAccountId: 9, shipments: [], batchId: "destination", businessId: "tenant-a",
    });
    mocks.drafts.mockRejectedValue(new ShippingBatchError("Duplicate shipment.", 409));
    expect((await POST(request())).status).toBe(409);
  });
  it("returns legacy, explicit-null and moved membership with ownership and parcel summaries", async () => {
    const row = {
      shipment_id: 1, revision: 2, so_id: 11, so_number: "SO11", operation_key: "legacy:11",
      created_at: new Date("2026-10-12T00:00:00Z"), updated_at: "2026-10-12 10:00:00",
      membership_id: null, batch_revision: null, batch_key: null, parcel_count: "2",
      ims_fulfilled_at: null, manifest_id: null,
    };
    mocks.query.mockResolvedValue([row,
      { ...row, shipment_id: 2, membership_id: 2, batch_revision: 3, ims_fulfilled_at: new Date("2026-10-12T00:00:00Z"), manifest_id: 4 },
      { ...row, shipment_id: 3, membership_id: 3, batch_revision: 1, batch_key: "moved" },
    ]);
    const response = await GET();
    const { data } = await response.json();
    expect(data[0]).toMatchObject({
      batchId: "legacy", batchRevision: 0, revision: 2, parcelCount: 2,
      imsFulfilledAt: null, manifestId: null, createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12 10:00:00",
    });
    expect(data[1]).toMatchObject({ batchId: null, batchRevision: 3, imsFulfilledAt: "2026-10-12T00:00:00.000Z", manifestId: 4 });
    expect(data[2]).toMatchObject({ batchId: "moved", batchRevision: 1 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("membership.business_id = shipment.business_id"), ["tenant-a"]);
  });
  it.each([true, false])("wires parsed recipients and exact store identity into display-only names (JSON string: %s)", async encoded => {
    const recipient = { name: "Online Customer", country: "AU" };
    const row = {
      shipment_id: 1, revision: 2, so_id: 11, so_number: "SO11", operation_key: "legacy:11",
      customer_name: "Online Customer", recipient_json: encoded ? JSON.stringify(recipient) : recipient,
      sales_channel: "shopify", channel_instance_id: "store-a", external_order_id: "100",
      provider_shipment_id: "carrier-unchanged", charged_cost: "7.43",
    };
    mocks.query.mockResolvedValue([row]);
    mocks.names.mockResolvedValue(new Map([[1, { name: "Jane Smith", issue: null }]]));
    const { data } = await (await GET()).json();
    expect(mocks.names).toHaveBeenCalledWith("tenant-a", [{
      shipmentId: 1, recipientName: "Online Customer", customerName: "Online Customer",
      salesChannel: "shopify", channelInstanceId: "store-a", externalOrderId: "100",
    }]);
    expect(data[0]).toMatchObject({
      customerName: "Jane Smith", customerNameIssue: null, destinationCountry: "AU",
      providerShipmentId: "carrier-unchanged", chargedCost: 7.43,
    });
    expect(row.recipient_json).toEqual(encoded ? JSON.stringify(recipient) : recipient);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.drafts).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("keeps shipments available and forwards explicit customer-name lookup warnings", async () => {
    mocks.query.mockResolvedValue([{ shipment_id: 1, operation_key: "legacy:11" }]);
    mocks.names.mockResolvedValue(new Map([[1, { name: null, issue: "Unable to load this order's customer name from Shopify. Refresh to retry." }]]));
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toMatchObject({
      customerName: null, customerNameIssue: expect.stringContaining("Refresh to retry"),
    });
  });
});
