import { getShopifyOperationContext } from "@/lib/channels/shopifyOperationContext";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";
import { ShopifyService } from "@/services/ShopifyService";
import { imsQuery } from "@/services/IMSMySQLService";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isPlaceholderShippingCustomerName } from "./shippingWorkflow";
export { isPlaceholderShippingCustomerName } from "./shippingWorkflow";

type ShippingCustomerSource = {
  shipmentId: number;
  recipientName: unknown;
  customerName: string | null;
  salesChannel: string | null;
  channelInstanceId: string | null;
  externalOrderId: string | null;
};

type ShippingCustomerDisplay = { name: string | null; issue: string | null };

function specificName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && !isPlaceholderShippingCustomerName(name) ? name : null;
}

export async function resolveShippingOrderCustomerName(
  businessId: string, soId: number, recipientName: unknown,
  connection?: Pick<PoolConnection, 'execute'>,
): Promise<ShippingCustomerDisplay> {
  const savedName = specificName(recipientName);
  if (savedName) return { name: savedName, issue: null };
  type CustomerRow = RowDataPacket & {
    customer_name: string | null; sales_channel: string | null;
    channel_instance_id: string | null; external_order_id: string | null;
  };
  const sql = `SELECT contact.name AS customer_name, sales_order.sales_channel,
            sales_order.channel_instance_id, sales_order.external_order_id
       FROM ims_sales_orders sales_order
       LEFT JOIN ims_contacts contact
         ON contact.id = sales_order.customer_id AND contact.business_id = sales_order.business_id
      WHERE sales_order.business_id = ? AND sales_order.id = ? LIMIT 1`;
  const rows = connection
    ? (await connection.execute<CustomerRow[]>(sql, [businessId, soId]))[0]
    : await imsQuery<CustomerRow>(sql, [businessId, soId]);
  if (!rows[0]) throw new Error("Sales order not found while resolving the shipping recipient.");
  const row = rows[0];
  const names = await resolveShippingCustomerNames(businessId, [{
    shipmentId: soId, recipientName, customerName: row.customer_name,
    salesChannel: row.sales_channel, channelInstanceId: row.channel_instance_id,
    externalOrderId: row.external_order_id,
  }]);
  const result = names.get(soId);
  if (!result) throw new Error("Shipping recipient lookup returned no result.");
  return result;
}

export async function resolveShippingCustomerNames(
  businessId: string,
  shipments: readonly ShippingCustomerSource[],
): Promise<Map<number, ShippingCustomerDisplay>> {
  const names = new Map<number, ShippingCustomerDisplay>();
  const groups = new Map<string, ShippingCustomerSource[]>();
  for (const shipment of shipments) {
    const name = specificName(shipment.recipientName) ?? specificName(shipment.customerName);
    names.set(shipment.shipmentId, { name, issue: name ? null : "No order-specific customer name is saved." });
    if (!name && shipment.salesChannel === "shopify" && shipment.channelInstanceId && shipment.externalOrderId) {
      const group = groups.get(shipment.channelInstanceId) ?? [];
      group.push(shipment);
      groups.set(shipment.channelInstanceId, group);
    }
  }
  for (const [channelInstanceId, group] of groups) {
    let unresolvedCount = group.length;
    let errorType = "MissingCustomerName";
    try {
      const { credentials } = await getShopifyOperationContext({ businessId, channelInstanceId });
      const service = new ShopifyService(credentials.shopName, credentials.token);
      const recipients = await service.getOrderRecipientNames(group.map(shipment => shipment.externalOrderId!));
      for (const shipment of group) {
        const name = specificName(recipients.get(shipment.externalOrderId!));
        names.set(shipment.shipmentId, {
          name, issue: name ? null : "Shopify did not provide an order-specific customer name.",
        });
        if (name) unresolvedCount--;
      }
      if (!unresolvedCount) continue;
    } catch (error) {
      errorType = error instanceof Error ? error.name : "UnknownError";
      for (const shipment of group) names.set(shipment.shipmentId, {
        name: null, issue: "Unable to load this order's customer name from Shopify. Refresh to retry.",
      });
    }
    await reportRuntimeIssue({
      businessId, source: "ims_shipping", operation: "resolve_customer_names",
      title: "Shipping customer names could not be resolved",
      error: new Error("Shopify customer name lookup did not complete."),
      context: { channelInstanceId, orderCount: group.length, unresolvedCount, errorType },
      reference: { type: "sales_channel", id: channelInstanceId },
    });
  }
  return names;
}
