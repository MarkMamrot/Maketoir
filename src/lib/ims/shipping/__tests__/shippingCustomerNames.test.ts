import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPlaceholderShippingCustomerName, resolveShippingCustomerNames, resolveShippingOrderCustomerName } from "../shippingCustomerNames";

const mocks = vi.hoisted(() => ({ context: vi.fn(), names: vi.fn(), report: vi.fn(), constructor: vi.fn(), query: vi.fn() }));
vi.mock("@/services/IMSMySQLService", () => ({ imsQuery: mocks.query }));
vi.mock("@/lib/channels/shopifyOperationContext", () => ({ getShopifyOperationContext: mocks.context }));
vi.mock("@/lib/runtimeIssues", () => ({ reportRuntimeIssue: mocks.report }));
vi.mock("@/services/ShopifyService", () => ({
  ShopifyService: class {
    constructor(shop: string, token: string) { mocks.constructor(shop, token); }
    getOrderRecipientNames = mocks.names;
  },
}));

const shipment = {
  shipmentId: 1, recipientName: "Online Customer", customerName: "Online Customer",
  salesChannel: "shopify", channelInstanceId: "store-a", externalOrderId: "100",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ credentials: { shopName: "store-a", token: "private-token" } });
  mocks.names.mockResolvedValue(new Map([["100", "Jane Smith"]]));
  mocks.query.mockResolvedValue([{ customer_name: "Online Customer", sales_channel: "shopify", channel_instance_id: "store-a", external_order_id: "100" }]);
});

describe("display-only shipping customer names", () => {
  it("recognizes only the generic contact, including whitespace and case differences", () => {
    for (const value of ["Online Customer", " ONLINE CUSTOMER "]) expect(isPlaceholderShippingCustomerName(value)).toBe(true);
    for (const value of ["Jane Smith", "", null]) expect(isPlaceholderShippingCustomerName(value)).toBe(false);
  });

  it("resolves an order recipient using tenant-filtered metadata and the exact store", async () => {
    expect(await resolveShippingOrderCustomerName("tenant-a", 12, "Online Customer")).toEqual({ name: "Jane Smith", issue: null });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("sales_order.business_id = ? AND sales_order.id = ?"), ["tenant-a", 12]);
    expect(mocks.context).toHaveBeenCalledWith({ businessId: "tenant-a", channelInstanceId: "store-a" });
  });

  it("keeps specific manual recipients without querying contact or Shopify data", async () => {
    expect(await resolveShippingOrderCustomerName("tenant-a", 12, "Gift Recipient")).toEqual({ name: "Gift Recipient", issue: null });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("uses a caller-owned connection for recipient metadata without borrowing another IMS slot", async () => {
    const execute = vi.fn().mockResolvedValue([[{ customer_name: 'Saved Buyer', sales_channel: 'shopify', channel_instance_id: 'store-a', external_order_id: '100' }]]);
    expect(await resolveShippingOrderCustomerName('tenant-a', 12, 'Online Customer', { execute })).toEqual({ name: 'Saved Buyer', issue: null });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('sales_order.business_id = ? AND sales_order.id = ?'), ['tenant-a', 12]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.names).not.toHaveBeenCalled();
  });

  it("does not turn a missing order or lookup failure into a usable shipping name", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(resolveShippingOrderCustomerName("tenant-a", 12, "Online Customer")).rejects.toThrow("Sales order not found");
    mocks.names.mockRejectedValue(new Error("provider unavailable"));
    expect(await resolveShippingOrderCustomerName("tenant-a", 12, "Online Customer")).toMatchObject({ name: null, issue: expect.stringContaining("Refresh to retry") });
    expect(mocks.report).toHaveBeenCalled();
  });
  it("uses a specific saved recipient first without requesting Shopify or altering input", async () => {
    const input = Object.freeze({ ...shipment, recipientName: " Saved Recipient ", customerName: "Purchaser" });
    const names = await resolveShippingCustomerNames("tenant-a", [input]);
    expect(names.get(1)).toEqual({ name: "Saved Recipient", issue: null });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(input.recipientName).toBe(" Saved Recipient ");
  });

  it("uses named contacts when saved recipient names are absent or generic", async () => {
    const names = await resolveShippingCustomerNames("tenant-a", [
      { ...shipment, recipientName: null, customerName: "Known Contact" },
      { ...shipment, shipmentId: 2, recipientName: " ONLINE CUSTOMER ", customerName: "Another Contact" },
    ]);
    expect(names.get(1)?.name).toBe("Known Contact");
    expect(names.get(2)?.name).toBe("Another Contact");
    expect(mocks.names).not.toHaveBeenCalled();
  });

  it("recovers generic names through the exact tenant-owned Shopify instance using read-only service calls", async () => {
    const names = await resolveShippingCustomerNames("tenant-a", [shipment]);
    expect(mocks.context).toHaveBeenCalledWith({ businessId: "tenant-a", channelInstanceId: "store-a" });
    expect(mocks.constructor).toHaveBeenCalledWith("store-a", "private-token");
    expect(mocks.names).toHaveBeenCalledWith(["100"]);
    expect(names.get(1)).toEqual({ name: "Jane Smith", issue: null });
    expect(shipment.recipientName).toBe("Online Customer");
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("isolates identical external order IDs in different stores and batches each store's lookups", async () => {
    mocks.context.mockImplementation(async ({ channelInstanceId }: { channelInstanceId: string }) => ({
      credentials: { shopName: channelInstanceId, token: "private-token" },
    }));
    mocks.names.mockResolvedValueOnce(new Map([["100", "Store A Recipient"], ["101", "Second Recipient"]]))
      .mockResolvedValueOnce(new Map([["100", "Store B Recipient"]]));
    const names = await resolveShippingCustomerNames("tenant-a", [
      shipment, { ...shipment, shipmentId: 2, externalOrderId: "101" },
      { ...shipment, shipmentId: 3, channelInstanceId: "store-b" },
    ]);
    expect(mocks.names.mock.calls).toEqual([[["100", "101"]], [["100"]]]);
    expect(names.get(1)?.name).toBe("Store A Recipient");
    expect(names.get(3)?.name).toBe("Store B Recipient");
  });

  it("never guesses a Shopify store or queries other providers when ownership is missing", async () => {
    const names = await resolveShippingCustomerNames("tenant-a", [
      { ...shipment, channelInstanceId: null },
      { ...shipment, shipmentId: 2, externalOrderId: null },
      { ...shipment, shipmentId: 3, salesChannel: "amazon" },
    ]);
    for (const result of names.values()) {
      expect(result.name).toBeNull();
      expect(result.issue).toMatch(/No order-specific/);
    }
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("preserves successful names while visibly reporting missing names without customer data", async () => {
    const names = await resolveShippingCustomerNames("tenant-a", [
      shipment, { ...shipment, shipmentId: 2, externalOrderId: "101" },
    ]);
    expect(names.get(1)?.name).toBe("Jane Smith");
    expect(names.get(2)).toMatchObject({ name: null, issue: expect.stringContaining("Shopify did not provide") });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: "tenant-a", operation: "resolve_customer_names",
      context: expect.objectContaining({ channelInstanceId: "store-a", unresolvedCount: 1 }),
    }));
    expect(JSON.stringify(mocks.report.mock.calls)).not.toMatch(/Jane Smith|private-token/);
  });

  it("surfaces provider failures without failing the shipping list or persisting raw errors", async () => {
    mocks.names.mockRejectedValue(new Error("raw customer payload and private-token"));
    const names = await resolveShippingCustomerNames("tenant-a", [shipment]);
    expect(names.get(1)).toMatchObject({ name: null, issue: expect.stringContaining("Refresh to retry") });
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.report.mock.calls)).not.toMatch(/raw customer payload|private-token/);
  });
});
