import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";
import { imsQuery } from "@/services/IMSMySQLService";

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const selection = new URL(request.url).searchParams.get("selected");
  const selectedIds = selection ? selection.split(",") : [];
  if (
    selectedIds.length > 250 ||
    selectedIds.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
  ) {
    return NextResponse.json(
      { success: false, error: "Select up to 250 valid sales orders." },
      { status: 400 },
    );
  }
  const prioritizedIds = [...new Set(selectedIds.map(Number))];
  try {
    const rows = await imsQuery<{ id: number | string; ordered_quantity: number | string; remaining_quantity: number | string }>(
      `SELECT sales_order.id, sales_order.so_number, sales_order.status, sales_order.so_type,
              sales_order.sales_channel, sales_order.shopify_order_name, sales_order.native_checkout_id,
              sales_order.channel_shipping_method, sales_order.channel_delivery_type,
              sales_order.delivery_country,
              (SELECT preparation.id FROM ims_shipping_shipments preparation
                 JOIN ims_shipping_batch_memberships membership
                   ON membership.business_id = preparation.business_id AND membership.shipment_id = preparation.id
                WHERE preparation.business_id = sales_order.business_id AND preparation.so_id = sales_order.id
                  AND preparation.provider_shipment_id IS NULL AND preparation.ims_fulfilled_at IS NULL
                  AND preparation.status IN ('draft', 'failed') AND membership.batch_key IS NULL
                ORDER BY preparation.id DESC LIMIT 1) AS preparation_shipment_id,
              contact.name AS customer_name,
              SUM(order_item.qty_ordered) AS ordered_quantity,
              SUM(GREATEST(order_item.qty_ordered - COALESCE(order_item.qty_fulfilled, 0), 0)) AS remaining_quantity
         FROM ims_sales_orders sales_order
         JOIN ims_sales_order_items order_item ON order_item.so_id = sales_order.id
         LEFT JOIN ims_contacts contact
           ON contact.id = sales_order.customer_id AND contact.business_id = sales_order.business_id
        WHERE sales_order.business_id = ?
          AND sales_order.status IN ('confirmed', 'partially_fulfilled')
          AND sales_order.so_type IN ('online', 'b2b')
          AND COALESCE(sales_order.channel_delivery_type, '') <> 'pickup'
          AND NOT EXISTS (
            SELECT 1 FROM ims_shipping_shipments shipment
             WHERE shipment.business_id = sales_order.business_id AND shipment.so_id = sales_order.id
               AND shipment.status NOT IN ('complete', 'voided', 'manifested')
               AND NOT (
                 shipment.provider_shipment_id IS NULL AND shipment.ims_fulfilled_at IS NULL
                 AND shipment.status IN ('draft', 'failed')
                 AND EXISTS (
                   SELECT 1 FROM ims_shipping_batch_memberships membership
                    WHERE membership.business_id = shipment.business_id AND membership.shipment_id = shipment.id
                      AND membership.batch_key IS NULL
                 )
               )
          )
        GROUP BY sales_order.id, sales_order.so_number, sales_order.status, sales_order.so_type,
                 sales_order.sales_channel, sales_order.shopify_order_name, sales_order.native_checkout_id,
                 sales_order.channel_shipping_method, sales_order.channel_delivery_type,
                 sales_order.delivery_country, contact.name
       HAVING remaining_quantity > 0
        ORDER BY ${prioritizedIds.length ? `CASE WHEN sales_order.id IN (${prioritizedIds.map(() => "?").join(",")}) THEN 0 ELSE 1 END, ` : ""}sales_order.order_date, sales_order.id
        LIMIT 250`,
      [session.businessId, ...prioritizedIds],
    );
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        ordered_quantity: Number(row.ordered_quantity),
        remaining_quantity: Number(row.remaining_quantity),
      })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: "ims_shipping",
      operation: "list_ready_orders",
      title: "Shipping workspace could not load ready orders",
      error,
    });
    return NextResponse.json(
      { success: false, error: "Unable to load orders ready to ship." },
      { status: 500 },
    );
  }
}
