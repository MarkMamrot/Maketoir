import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";
import { imsQuery } from "@/services/IMSMySQLService";

export async function GET() {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const rows = await imsQuery<any>(
      `SELECT sales_order.id, sales_order.so_number, sales_order.status, sales_order.so_type,
              sales_order.sales_channel, sales_order.shopify_order_name, sales_order.native_checkout_id,
              sales_order.channel_shipping_method, sales_order.channel_delivery_type,
              sales_order.delivery_country,
              contact.name AS customer_name,
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
          )
        GROUP BY sales_order.id, sales_order.so_number, sales_order.status, sales_order.so_type,
                 sales_order.sales_channel, sales_order.shopify_order_name, sales_order.native_checkout_id,
                 sales_order.channel_shipping_method, sales_order.channel_delivery_type,
                 sales_order.delivery_country, contact.name
       HAVING remaining_quantity > 0
        ORDER BY sales_order.order_date, sales_order.id
        LIMIT 250`,
      [session.businessId],
    );
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        id: Number(row.id),
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
