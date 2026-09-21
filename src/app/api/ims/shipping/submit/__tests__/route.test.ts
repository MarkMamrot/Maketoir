import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockReadiness, mockSubmit, mockReport } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockReadiness: vi.fn(),
  mockSubmit: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock("@/lib/auth/imsSession", () => ({ getImsSession: mockGetSession }));
vi.mock("@/lib/ims/shipping/shippingStockReadiness", () => ({ getShippingStockReadiness: mockReadiness }));
vi.mock("@/lib/ims/shipping/shippingSubmission", () => ({
  ShippingBatchSubmissionError: class ShippingBatchSubmissionError extends Error {},
  submitShippingDraftsAndCreateLabels: mockSubmit,
}));
vi.mock("@/lib/runtimeIssues", () => ({ reportRuntimeIssue: mockReport }));

import { POST } from "../route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/ims/shipping/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const shortage = {
  ready: false,
  lines: [{ locationId: 4, variantId: "variant-1", shortfallQuantity: 1 }],
};

describe("POST shipping submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ businessId: "biz-1", tier: "Admin" });
    mockSubmit.mockResolvedValue([{ shipmentId: 48, status: "label_ready" }]);
  });

  it("blocks carrier submission when current on-hand stock is short", async () => {
    mockReadiness.mockResolvedValue(shortage);

    const response = await POST(request({ shipmentIds: [48] }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "STOCK_NOT_READY", stockReadiness: shortage });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("submits after an explicit stock-shortfall acknowledgement", async () => {
    mockReadiness.mockResolvedValue(shortage);

    const response = await POST(request({ shipmentIds: [48], acknowledgeStockShortfall: true }));

    expect(response.status).toBe(200);
    expect(mockSubmit).toHaveBeenCalledWith({ businessId: "biz-1", shipmentIds: [48] });
  });
});
