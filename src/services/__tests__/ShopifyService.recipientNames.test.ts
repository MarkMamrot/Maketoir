import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShopifyService } from "@/services/ShopifyService";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("shopify-api-node", () => ({
  default: class { order = { list: mocks.list }; },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
});

describe("Shopify shipping recipient name reads", () => {
  it("reads only the requested orders and name sources, without creating or amending anything", async () => {
    mocks.list.mockResolvedValue([
      { id: 100, shipping_address: { name: "Jane Smith" }, customer: { first_name: "Purchaser" } },
      { id: 101, customer: { first_name: "Alex", last_name: "Jones" } },
      { id: 999, shipping_address: { name: "Unrequested Recipient" } },
    ]);
    const service = new ShopifyService("store-a", "private-token");
    const names = await service.getOrderRecipientNames(["100", "101", "100"]);
    expect([...names]).toEqual([["100", "Jane Smith"], ["101", "Alex Jones"]]);
    expect(mocks.list).toHaveBeenCalledWith({
      ids: "100,101", fields: "id,shipping_address,customer,billing_address", status: "any", limit: 250,
    });
  });

  it("splits lookups at Shopify's 250-order limit", async () => {
    const service = new ShopifyService("store-a", "private-token");
    await service.getOrderRecipientNames(Array.from({ length: 251 }, (_, index) => String(index + 1)));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.calls[0][0].ids.split(",")).toHaveLength(250);
    expect(mocks.list.mock.calls[1][0].ids).toBe("251");
  });

  it.each(["0", "-1", "invalid", "1,2"])("rejects invalid order ID %s before a provider call", async id => {
    const service = new ShopifyService("store-a", "private-token");
    await expect(service.getOrderRecipientNames([id])).rejects.toThrow("Valid Shopify order IDs");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns no invented names when protected customer details are missing", async () => {
    mocks.list.mockResolvedValue([{ id: 100, customer: { email: "customer@example.test" } }]);
    expect(await new ShopifyService("store-a", "private-token").getOrderRecipientNames(["100"])).toEqual(new Map());
  });

  it("propagates provider failures for the caller's visible error handling", async () => {
    mocks.list.mockRejectedValue(new Error("Shopify unavailable"));
    await expect(new ShopifyService("store-a", "private-token").getOrderRecipientNames(["100"])).rejects.toThrow("Shopify unavailable");
  });
});
