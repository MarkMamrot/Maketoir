import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  fulfil: vi.fn(),
}));

vi.mock("@/services/IMSMySQLService", () => ({
  getIMSPool: () => ({ getConnection: async () => mocks }),
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock("@/lib/ims/orderResolution/customerFulfilment", () => ({
  fulfilSalesOrderPartialInTransaction: mocks.fulfil,
}));

import { dispatchShippingShipment } from "../shippingDispatch";

describe("shipping dispatch label revision guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to move stock using a label from an older shipment revision", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        id: 91, so_id: 12, status: "label_ready", revision: 2,
        manifest_id: null, ims_fulfilled_at: null, so_status: "confirmed",
      }]])
      .mockResolvedValueOnce([[]]);
    await expect(dispatchShippingShipment({ businessId: "tenant-one", shipmentId: 91 }))
      .rejects.toThrow("Generate fresh labels");
    expect(mocks.execute.mock.calls[1][0]).toContain("shipment_revision = ?");
    expect(mocks.execute.mock.calls[1][1]).toEqual(["tenant-one", 91, 2]);
    expect(mocks.fulfil).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each(["amending", "amendment_unknown", "carrier_created"])(
    "refuses dispatch while shipment is %s",
    async (status) => {
      mocks.execute.mockResolvedValueOnce([[{
        id: 91, so_id: 12, status, revision: 2,
        manifest_id: null, ims_fulfilled_at: null, so_status: "confirmed",
      }]]);
      await expect(dispatchShippingShipment({ businessId: "tenant-one", shipmentId: 91 }))
        .rejects.toThrow("only after its label is ready");
      expect(mocks.execute).toHaveBeenCalledOnce();
      expect(mocks.fulfil).not.toHaveBeenCalled();
    },
  );
});
