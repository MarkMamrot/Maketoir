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

export type ShopifyShipment = {
  shopifyFulfilmentId: string;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  items: Array<{ shopifyLineItemId: string; quantity: number }>;
  tracking: Array<{ company: string | null; number: string | null; url: string | null }>;
};

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

export function parseShopifyShipment(payload: unknown): ShopifyShipment | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const id = String(value.id ?? '').trim();
  if (!/^\d+$/.test(id) || id === '0') return null;
  const lines = Array.isArray(value.line_items) ? value.line_items : [];
  const items = lines.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const line = raw as Record<string, unknown>;
    const lineId = String(line.id ?? line.line_item_id ?? '').trim();
    const quantity = Number(line.quantity ?? 0);
    return /^\d+$/.test(lineId) && Number.isFinite(quantity) && quantity > 0
      ? [{ shopifyLineItemId: lineId, quantity }]
      : [];
  });
  const numbers = Array.isArray(value.tracking_numbers) ? value.tracking_numbers : [value.tracking_number];
  const urls = Array.isArray(value.tracking_urls) ? value.tracking_urls : [value.tracking_url];
  const company = optionalText(value.tracking_company, 255);
  const tracking = new Map<string, { company: string | null; number: string | null; url: string | null }>();
  const count = Math.max(numbers.length, urls.length);
  for (let index = 0; index < count; index += 1) {
    const number = optionalText(numbers[index], 255);
    const url = optionalText(urls[index], 2_000);
    if (!number && !url) continue;
    const entry = { company, number, url };
    tracking.set(`${number ?? ''}\u0000${url ?? ''}`, entry);
  }

  return {
    shopifyFulfilmentId: id,
    status: optionalText(value.status, 100),
    createdAt: optionalText(value.created_at, 50),
    updatedAt: optionalText(value.updated_at, 50),
    items,
    tracking: [...tracking.values()],
  };
}

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