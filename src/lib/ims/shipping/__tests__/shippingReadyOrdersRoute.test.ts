import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/ims/shipping/orders/route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/imsSession", () => ({ getImsSession: mocks.session }));
vi.mock("@/services/IMSMySQLService", () => ({ imsQuery: mocks.query }));
vi.mock("@/lib/runtimeIssues", () => ({ reportRuntimeIssue: mocks.report }));

const request = (selection?: string) => new Request(
  `http://localhost/api/ims/shipping/orders${selection === undefined ? "" : `?selected=${encodeURIComponent(selection)}`}`,
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: "tenant-a" });
  mocks.query.mockResolvedValue([{ id: "10", ordered_quantity: "3.5", remaining_quantity: "1.5" }]);
});

describe("ready shipping orders", () => {
  it("keeps the default oldest-first queue and numeric output", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [{ id: 10, ordered_quantity: 3.5, remaining_quantity: 1.5 }] });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY sales_order.order_date, sales_order.id"),
      ["tenant-a"],
    );
    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain("SUM(order_item.qty_ordered) AS ordered_quantity");
    expect(sql).toContain("SUM(GREATEST(order_item.qty_ordered - COALESCE(order_item.qty_fulfilled, 0), 0)) AS remaining_quantity");
  });

  it("prioritizes selected orders before the limit without bypassing eligibility or tenant filtering", async () => {
    await GET(request("301,302,301"));
    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(parameters).toEqual(["tenant-a", 301, 302]);
    expect(sql).toContain("sales_order.business_id = ?");
    expect(sql).toContain("AND NOT EXISTS");
    expect(sql).toContain("membership.batch_key IS NULL");
    expect(sql).toMatch(/ORDER BY CASE WHEN sales_order\.id IN \(\?,\?\) THEN 0 ELSE 1 END, sales_order\.order_date, sales_order\.id\s+LIMIT 250/);
  });

  it.each(["0", "-1", "1.2", "abc", "1,,2", "1 OR 1=1", "9007199254740992"])(
    "rejects invalid selected IDs: %s",
    async selection => {
      expect((await GET(request(selection))).status).toBe(400);
      expect(mocks.query).not.toHaveBeenCalled();
      expect(mocks.report).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized selections explicitly", async () => {
    expect((await GET(request(Array.from({ length: 251 }, (_, index) => index + 1).join(",")))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires authentication before querying", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("records unexpected database failures for the resolved tenant", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(request("301"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Unable to load orders ready to ship." });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: "tenant-a", operation: "list_ready_orders",
    }));
  });
});
