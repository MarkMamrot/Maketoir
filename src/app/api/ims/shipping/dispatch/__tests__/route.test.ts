import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDispatch, mockReport } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDispatch: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock("@/lib/auth/imsSession", () => ({ getImsSession: mockGetSession }));
vi.mock("@/lib/ims/shipping/shippingDispatch", () => ({ dispatchShippingShipment: mockDispatch }));
vi.mock("@/lib/runtimeIssues", () => ({ reportRuntimeIssue: mockReport }));

import { StockShortfallError } from "@/lib/ims/orderResolution/stockShortfall";
import { POST } from "../route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/ims/shipping/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST shipping dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ businessId: "biz-1", tier: "Admin" });
  });

  it("returns the blocked shipment and structured stock shortfall", async () => {
    mockDispatch.mockRejectedValue(new StockShortfallError([{
      itemId: 10,
      variantId: "variant-1",
      sku: "SKU-1",
      requestedQuantity: 1,
      quantityOnHand: 0,
      resultingQuantityOnHand: -1,
    }]));

    const response = await POST(request({ shipmentIds: [48, 49] }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "STOCK_SHORTFALL",
      shipmentId: 48,
      shortfalls: [{ sku: "SKU-1", quantityOnHand: 0 }],
    });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("passes an explicit negative-stock confirmation to every shipment", async () => {
    mockDispatch.mockResolvedValue({ shipmentStatus: "complete" });

    const response = await POST(request({ shipmentIds: [48, 49], allowNegativeStock: true }));

    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenNthCalledWith(1, {
      businessId: "biz-1",
      shipmentId: 48,
      allowNegativeStock: true,
    });
    expect(mockDispatch).toHaveBeenNthCalledWith(2, {
      businessId: "biz-1",
      shipmentId: 49,
      allowNegativeStock: true,
    });
  });
});