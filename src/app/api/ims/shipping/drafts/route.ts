import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { createShippingDrafts } from "@/lib/ims/shipping/shippingDrafts";
import { canDeleteShippingDraft } from "@/lib/ims/shipping/shippingWorkflow";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";
import { imsExecute, imsQuery } from "@/services/IMSMySQLService";

export async function GET() {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const rows = await imsQuery<{
      shipment_id: number;
      so_id: number;
      so_number: string;
      channel_order_number: string | null;
      operation_key: string;
      customer_name: string | null;
      status: string;
      service_code: string | null;
      service_name: string | null;
      quoted_cost: number | null;
      charged_cost: number | null;
      provider_shipment_id: string | null;
      label_status: string | null;
      label_url: string | null;
      created_at: string | Date;
      updated_at: string | Date;
    }>(
      `SELECT shipment.id AS shipment_id, shipment.so_id, shipment.operation_key, sales_order.so_number,
              COALESCE(NULLIF(sales_order.shopify_order_name, ''), NULLIF(sales_order.native_checkout_id, '')) AS channel_order_number,
              contact.name AS customer_name, shipment.status, shipment.service_code, shipment.service_name,
              shipment.quoted_cost, shipment.charged_cost, shipment.provider_shipment_id,
              label.status AS label_status, label.label_url, shipment.created_at, shipment.updated_at
         FROM ims_shipping_shipments shipment
         JOIN ims_sales_orders sales_order
           ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
         LEFT JOIN ims_contacts contact ON contact.id = sales_order.customer_id AND contact.business_id = sales_order.business_id
         LEFT JOIN ims_shipping_labels label
           ON label.id = (
             SELECT latest.id FROM ims_shipping_labels latest
              WHERE latest.business_id = shipment.business_id AND latest.shipment_id = shipment.id
              ORDER BY latest.id DESC LIMIT 1
           )
        WHERE shipment.business_id = ?
          AND shipment.status NOT IN ('complete', 'voided', 'manifested')
        ORDER BY shipment.updated_at DESC, shipment.id DESC`,
      [session.businessId],
    );
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        shipmentId: Number(row.shipment_id),
        soId: Number(row.so_id),
        soNumber: row.so_number,
        batchId: row.operation_key.replace(/:\d+$/, ""),
        channelOrderNumber: row.channel_order_number,
        customerName: row.customer_name,
        status: row.status,
        serviceCode: row.service_code,
        serviceName: row.service_name,
        quotedCost: row.quoted_cost == null ? null : Number(row.quoted_cost),
        chargedCost: row.charged_cost == null ? null : Number(row.charged_cost),
        providerShipmentId: row.provider_shipment_id,
        labelStatus: row.label_status,
        labelUrl: row.label_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: "ims_shipping",
      operation: "list_active_shipments",
      title: "Shipping workspace could not load saved shipments",
      error,
    });
    return NextResponse.json(
      { error: "Unable to load saved shipments." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.tier === "Advisor")
    return NextResponse.json(
      { error: "Advisor accounts are read-only." },
      { status: 403 },
    );
  try {
    const body = await request.json();
    const data = await createShippingDrafts({
      businessId: session.businessId,
      operationKey: String(body?.operationKey ?? ""),
      carrierAccountId: Number(body?.carrierAccountId),
      shipments: Array.isArray(body?.shipments) ? body.shipments : [],
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to prepare shipments.";
    const validation =
      /required|choose|not found|incomplete|cannot|exceeds|remaining|already used/i.test(
        message,
      );
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: "ims_shipping",
        operation: "create_drafts",
        title: "Shipping drafts could not be created",
        error,
        context: { shipmentCount: undefined },
      });
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: validation ? 400 : 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.tier === "Advisor")
    return NextResponse.json(
      { error: "Advisor accounts are read-only." },
      { status: 403 },
    );
  try {
    const body = await request.json();
    const shipmentIds = [
      ...new Set(
        (Array.isArray(body?.shipmentIds) ? body.shipmentIds : [])
          .map(Number)
          .filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (!shipmentIds.length)
      return NextResponse.json(
        { error: "Choose at least one shipment draft." },
        { status: 400 },
      );
    if (shipmentIds.length > 100)
      return NextResponse.json(
        { error: "Delete no more than 100 shipment drafts at once." },
        { status: 400 },
      );

    const placeholders = shipmentIds.map(() => "?").join(",");
    const rows = await imsQuery<{
      id: number;
      status: string;
      provider_shipment_id: string | null;
    }>(
      `SELECT id, status, provider_shipment_id
         FROM ims_shipping_shipments
        WHERE business_id = ? AND id IN (${placeholders})`,
      [session.businessId, ...shipmentIds],
    );
    if (
      rows.length !== shipmentIds.length ||
      rows.some(
        (row) => !canDeleteShippingDraft(row.status, row.provider_shipment_id),
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only local drafts that have not been submitted to a carrier can be deleted.",
        },
        { status: 409 },
      );
    }

    const result = await imsExecute(
      `DELETE FROM ims_shipping_shipments
        WHERE business_id = ? AND id IN (${placeholders})
          AND provider_shipment_id IS NULL AND status IN ('draft', 'quoting', 'failed')`,
      [session.businessId, ...shipmentIds],
    );
    if (result.affectedRows !== shipmentIds.length) {
      return NextResponse.json(
        {
          error:
            "One or more drafts changed while deleting. Refresh the workspace and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      data: { deletedShipmentIds: shipmentIds },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: "ims_shipping",
      operation: "delete_drafts",
      title: "Shipping drafts could not be deleted",
      error,
    });
    return NextResponse.json(
      { success: false, error: "Unable to delete shipment drafts." },
      { status: 500 },
    );
  }
}
