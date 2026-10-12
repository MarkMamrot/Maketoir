import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { createShippingDrafts } from "@/lib/ims/shipping/shippingDrafts";
import { canDeleteShippingDraft } from "@/lib/ims/shipping/shippingWorkflow";
import { getShippingBatchId, ShippingBatchError } from "@/lib/ims/shipping/shippingBatchTypes";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";
import { imsExecute, imsQuery } from "@/services/IMSMySQLService";

export async function GET() {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const rows = await imsQuery<{
      shipment_id: number;
      revision: number;
      membership_id: number | null;
      batch_key: string | null;
      batch_revision: number | null;
      parcel_count: number;
      ims_fulfilled_at: string | Date | null;
      manifest_id: number | null;
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
      is_international: number;
      export_purpose: string | null;
      declared_currency: string | null;
      customs_json: unknown;
      recipient_json: unknown;
      label_status: string | null;
      label_url: string | null;
      created_at: string | Date;
      updated_at: string | Date;
    }>(
      `SELECT shipment.id AS shipment_id, shipment.revision, shipment.so_id, shipment.operation_key, sales_order.so_number,
              shipment.ims_fulfilled_at, shipment.manifest_id,
              membership.shipment_id AS membership_id, membership.batch_key, membership.revision AS batch_revision,
              (SELECT COUNT(*) FROM ims_shipping_parcels parcel
                WHERE parcel.business_id = shipment.business_id AND parcel.shipment_id = shipment.id) AS parcel_count,
              COALESCE(NULLIF(sales_order.shopify_order_name, ''), NULLIF(sales_order.native_checkout_id, '')) AS channel_order_number,
              contact.name AS customer_name, shipment.status, shipment.service_code, shipment.service_name,
              shipment.quoted_cost, shipment.charged_cost, shipment.provider_shipment_id,
              shipment.is_international, shipment.export_purpose, shipment.declared_currency,
              shipment.customs_json, shipment.recipient_json,
              label.status AS label_status, label.label_url, shipment.created_at, shipment.updated_at
         FROM ims_shipping_shipments shipment
         JOIN ims_sales_orders sales_order
           ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
         LEFT JOIN ims_contacts contact ON contact.id = sales_order.customer_id AND contact.business_id = sales_order.business_id
         LEFT JOIN ims_shipping_batch_memberships membership
           ON membership.business_id = shipment.business_id AND membership.shipment_id = shipment.id
         LEFT JOIN ims_shipping_labels label
           ON label.id = (
             SELECT latest.id FROM ims_shipping_labels latest
              WHERE latest.business_id = shipment.business_id AND latest.shipment_id = shipment.id
                AND latest.shipment_revision = shipment.revision AND latest.status <> 'superseded'
              ORDER BY latest.id DESC LIMIT 1
           )
        WHERE shipment.business_id = ?
          AND shipment.status NOT IN ('voided', 'manifested')
          AND shipment.manifest_id IS NULL
        ORDER BY shipment.updated_at DESC, shipment.id DESC`,
      [session.businessId],
    );
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        shipmentId: Number(row.shipment_id),
        revision: Number(row.revision),
        soId: Number(row.so_id),
        soNumber: row.so_number,
        batchId: getShippingBatchId(row.operation_key,
          row.membership_id == null ? null : { batch_key: row.batch_key }),
        batchRevision: Number(row.batch_revision ?? 0),
        parcelCount: Number(row.parcel_count),
        imsFulfilledAt: row.ims_fulfilled_at == null ? null : serializeDate(row.ims_fulfilled_at),
        manifestId: row.manifest_id == null ? null : Number(row.manifest_id),
        channelOrderNumber: row.channel_order_number,
        customerName: row.customer_name,
        status: row.status,
        serviceCode: row.service_code,
        serviceName: row.service_name,
        quotedCost: row.quoted_cost == null ? null : Number(row.quoted_cost),
        chargedCost: row.charged_cost == null ? null : Number(row.charged_cost),
        providerShipmentId: row.provider_shipment_id,
        isInternational: Boolean(row.is_international),
        exportPurpose: row.export_purpose,
        declaredCurrency: row.declared_currency,
        customs: parseJsonValue(row.customs_json),
        destinationCountry: getRecipientCountry(row.recipient_json),
        labelStatus: row.label_status,
        labelUrl: row.label_url,
        createdAt: serializeDate(row.created_at),
        updatedAt: serializeDate(row.updated_at),
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

  function serializeDate(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : value;
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getRecipientCountry(value: unknown): string | null {
  const recipient = parseJsonValue(value);
  if (!recipient || typeof recipient !== "object") return null;
  const country = String((recipient as { country?: unknown }).country ?? "").trim();
  return country || null;
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
      ...(body?.batchId === undefined ? {} : { batchId: body.batchId }),
      carrierAccountId: Number(body?.carrierAccountId),
      shipments: Array.isArray(body?.shipments) ? body.shipments : [],
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ShippingBatchError)
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    if (error instanceof SyntaxError)
      return NextResponse.json({ success: false, error: "Invalid JSON request." }, { status: 400 });
    const message =
      error instanceof Error ? error.message : "Unable to prepare shipments.";
    const validation =
      /required|choose|not found|incomplete|cannot|exceeds|remaining|already used|valid|country|HS code|dangerous|restricted|confirm|declared value/i.test(
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
