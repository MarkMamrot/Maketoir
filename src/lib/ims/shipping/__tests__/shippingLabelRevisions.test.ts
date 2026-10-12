import { describe, expect, it, vi } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader } from "mysql2/promise";
import { shippingLabelRefreshIssue, supersedeShippingLabels } from "../shippingLabelRevisions";

const shipment = {
  id: 1,
  status: "label_ready",
  manifest_id: null,
  ims_fulfilled_at: null,
};
type Execute = (sql: string, values: (string | number)[]) => Promise<[QueryResult, FieldPacket[]]>;

describe("shared shipping label revision eligibility", () => {
  it("allows clean shared PDFs to be refreshed without changing postage", () => {
    expect(shippingLabelRefreshIssue([
      shipment,
      { ...shipment, id: 2, status: "carrier_created" },
    ])).toBe("");
    expect(shippingLabelRefreshIssue([])).toBe("");
  });

  it("blocks any shared PDF member already dispatched or included in a manifest", () => {
    expect(shippingLabelRefreshIssue([
      shipment, { ...shipment, id: 2, manifest_id: 3 },
    ])).toContain("dispatched or manifested");
    expect(shippingLabelRefreshIssue([
      { ...shipment, ims_fulfilled_at: "2026-10-12 00:00:00" },
    ])).toContain("dispatched or manifested");
  });

  it.each([
    "amending", "amendment_unknown", "submitting", "submission_unknown",
    "label_submitting", "label_pending", "label_unknown", "ims_fulfilled",
    "channel_pending", "complete", "manifested", "voided",
  ])("blocks a shared PDF member in %s state", (status) => {
    expect(shippingLabelRefreshIssue([{ ...shipment, status }])).not.toBe("");
  });

  it("supersedes the whole shared document while preserving shipment details and postage", async () => {
    const execute = vi.fn<Execute>();
    const result: ResultSetHeader = {
      fieldCount: 0, affectedRows: 2, insertId: 0, info: "", serverStatus: 2,
      warningStatus: 0, changedRows: 2, constructor: { name: "ResultSetHeader" },
    };
    execute.mockResolvedValueOnce([[
      { ...shipment, constructor: { name: "RowDataPacket" as const } },
      { ...shipment, id: 2, constructor: { name: "RowDataPacket" as const } },
    ], []]).mockResolvedValue([result, []]);
    expect(await supersedeShippingLabels({ execute }, "tenant-one", 1)).toEqual([1, 2]);
    const [labelSql, labelParams] = execute.mock.calls[1];
    expect(labelSql).toContain("status = 'superseded'");
    expect(labelParams).toEqual(["tenant-one", 1, 2]);
    const [shipmentSql, shipmentParams] = execute.mock.calls[2];
    expect(shipmentSql).toContain("revision = revision + 1");
    expect(shipmentSql).toContain("id <> ?");
    expect(shipmentSql).not.toMatch(/charged_cost\s*=|recipient_json\s*=|provider_shipment_id\s*=/);
    expect(shipmentParams).toEqual(["tenant-one", 1, 2, 1]);
  });

  it("never invalidates a shared PDF if another member has been dispatched", async () => {
    const execute = vi.fn<Execute>();
    execute.mockResolvedValueOnce([[
      { ...shipment, id: 2, ims_fulfilled_at: new Date(), constructor: { name: "RowDataPacket" as const } },
    ], []]);
    await expect(supersedeShippingLabels({ execute }, "tenant-one", 1))
      .rejects.toThrow("dispatched or manifested");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails visibly before invalidating labels if shared shipment state is malformed", async () => {
    const execute = vi.fn<Execute>();
    execute.mockResolvedValueOnce([[{ id: 2, constructor: { name: "RowDataPacket" as const } }], []]);
    await expect(supersedeShippingLabels({ execute }, "tenant-one", 1))
      .rejects.toThrow("state could not be verified");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
