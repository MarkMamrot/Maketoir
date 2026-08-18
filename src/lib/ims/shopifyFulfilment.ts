export type ShopifyFulfilmentOrderItem = {
  id: number;
  shopify_line_item_id: string | number | null;
  qty_ordered: number | string;
  qty_fulfilled: number | string | null;
};

export type ShopifyFulfilmentPayloadLine = {
  id?: string | number | null;
  quantity?: number | string | null;
};

export function buildShopifyShipmentQuantities(input: {
  topic: string;
  payloadLines: ShopifyFulfilmentPayloadLine[] | null | undefined;
  orderItems: ShopifyFulfilmentOrderItem[];
}): Array<{ itemId: number; quantity: number }> {
  const outstanding = (item: ShopifyFulfilmentOrderItem) => Math.max(
    0,
    Number(item.qty_ordered ?? 0) - Number(item.qty_fulfilled ?? 0),
  );

  if (input.topic === 'orders/fulfilled') {
    return input.orderItems
      .map(item => ({ itemId: Number(item.id), quantity: outstanding(item) }))
      .filter(item => item.quantity > 0);
  }

  if (!Array.isArray(input.payloadLines) || input.payloadLines.length === 0) {
    throw new Error('Shopify fulfillment did not include any line items.');
  }

  const orderItemsByShopifyId = new Map(
    input.orderItems
      .filter(item => item.shopify_line_item_id != null)
      .map(item => [String(item.shopify_line_item_id), item]),
  );
  const quantities = new Map<number, number>();
  for (const payloadLine of input.payloadLines) {
    const shopifyLineItemId = String(payloadLine?.id ?? '').trim();
    const orderItem = orderItemsByShopifyId.get(shopifyLineItemId);
    if (!orderItem) {
      throw new Error(`Shopify fulfillment line ${shopifyLineItemId || '(missing ID)'} is not mapped to this sales order.`);
    }
    const quantity = Number(payloadLine.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Shopify fulfillment line ${shopifyLineItemId} has an invalid quantity.`);
    }
    const itemId = Number(orderItem.id);
    quantities.set(itemId, (quantities.get(itemId) ?? 0) + quantity);
  }

  return [...quantities.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}