export type NotificationFact = { label: string; value: string };
export type NotificationDetailSection = { heading: string; facts: NotificationFact[] };
export type PosStockNotificationWarning = {
  itemName: string;
  previousOnHand: number;
  uncappedResultingOnHand: number;
  resultingOnHand: number;
  automaticAdjustmentQuantity: number;
  quantityCommitted: number;
  reason: string;
};

const LABELS: Record<string, string> = {
  action: 'Available action',
  affected_quantity: 'Quantity affected',
  allocation_count: 'Allocations affected',
  automaticAdjustmentQuantity: 'Automatic stock correction',
  branchTransferIncomingQuantity: 'Incoming branch-transfer quantity',
  error: 'What went wrong',
  fulfilment_location: 'Fulfilment location',
  incomingTransferQuantity: 'Incoming transfer quantity',
  is_fulfilment_location: 'Fulfilment location',
  itemName: 'Product',
  local_id: 'Device sale reference',
  location: 'Location',
  location_id: 'Location ID',
  po_id: 'Purchase order ID',
  previousOnHand: 'Stock before sale',
  product_name: 'Product',
  purchaseOrderIncomingQuantity: 'Incoming purchase-order quantity',
  qty: 'Quantity',
  qty_available: 'Available quantity',
  qty_committed: 'Committed quantity',
  qty_on_hand: 'Stock on hand',
  quantityCommitted: 'Committed quantity',
  quantityOnHand: 'Stock before fulfilment',
  ready_quantity: 'Quantity ready',
  reason: 'Reason',
  requested_quantity: 'Quantity requested',
  requestedQuantity: 'Quantity fulfilled',
  resultingOnHand: 'Final stock on hand',
  resultingQuantityOnHand: 'Final stock on hand',
  sale_id: 'POS sale',
  shopify_order_id: 'Shopify order ID',
  shopify_order_name: 'Shopify order',
  sku: 'SKU',
  so_id: 'Sales order ID',
  so_number: 'Sales order',
  topic: 'Shopify event',
  uncappedResultingOnHand: 'Stock without correction',
  variant_ids: 'Products attempted',
  wholesale_order_id: 'Wholesale order ID',
};

const VALUES: Record<string, string> = {
  committed_stock_at_risk: 'Sale reduced stock reserved for customer orders',
  negative_stock: 'Sale exceeded recorded stock on hand',
  incoming_transfer_stock: 'Sale used stock from an incoming branch transfer',
  open_sales_order: 'Open the sales order',
  received_short: 'Purchase order was received short',
};

const TECHNICAL_ONLY = new Set(['dedupe_key', 'variantId', 'variant_id', 'item_id']);

function friendlyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function friendlyValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return VALUES[value] ?? value;
  if (Array.isArray(value)) return value.map(friendlyValue).join(', ');
  return String(value);
}

function objectHeading(value: Record<string, unknown>, index: number, fallback: string): string {
  const identity = value.itemName ?? value.product_name ?? value.sku ?? value.shopify_order_name ?? value.so_number;
  return typeof identity === 'string' && identity.trim() ? identity : `${fallback} ${index + 1}`;
}

export function buildNotificationDetailSections(detail: unknown): NotificationDetailSection[] {
  if (detail == null) return [];
  if (typeof detail !== 'object' || Array.isArray(detail)) {
    return [{ heading: 'Details', facts: [{ label: 'Information', value: friendlyValue(detail) }] }];
  }

  const root = detail as Record<string, unknown>;
  const summary: NotificationFact[] = [];
  const sections: NotificationDetailSection[] = [];

  for (const [key, value] of Object.entries(root)) {
    if (value == null || value === '' || TECHNICAL_ONLY.has(key)) continue;
    if (!Array.isArray(value) && typeof value !== 'object') {
      summary.push({ label: friendlyLabel(key), value: friendlyValue(value) });
      continue;
    }
    if (!Array.isArray(value)) {
      const facts = Object.entries(value as Record<string, unknown>)
        .filter(([childKey, childValue]) => childValue != null && childValue !== '' && !TECHNICAL_ONLY.has(childKey) && typeof childValue !== 'object')
        .map(([childKey, childValue]) => ({ label: friendlyLabel(childKey), value: friendlyValue(childValue) }));
      if (facts.length) sections.push({ heading: friendlyLabel(key), facts });
      continue;
    }
    if (value.every(entry => entry == null || typeof entry !== 'object')) {
      const facts = value.filter(entry => entry != null).map((entry, index) => ({
        label: key === 'errors' ? `Issue ${index + 1}` : `${friendlyLabel(key)} ${index + 1}`,
        value: friendlyValue(entry),
      }));
      if (facts.length) sections.push({ heading: friendlyLabel(key), facts });
      continue;
    }
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;
      const facts = Object.entries(record)
        .filter(([childKey, childValue]) => childValue != null && childValue !== '' && !TECHNICAL_ONLY.has(childKey) && typeof childValue !== 'object')
        .map(([childKey, childValue]) => ({ label: friendlyLabel(childKey), value: friendlyValue(childValue) }));
      for (const [childKey, childValue] of Object.entries(record)) {
        if (!Array.isArray(childValue)) continue;
        childValue.forEach((nested, nestedIndex) => {
          if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return;
          for (const [nestedKey, nestedValue] of Object.entries(nested)) {
            if (nestedValue == null || nestedValue === '' || TECHNICAL_ONLY.has(nestedKey) || typeof nestedValue === 'object') continue;
            facts.push({
              label: `${friendlyLabel(childKey)} ${nestedIndex + 1}: ${friendlyLabel(nestedKey)}`,
              value: friendlyValue(nestedValue),
            });
          }
        });
      }
      if (facts.length) sections.push({ heading: objectHeading(record, index, friendlyLabel(key).replace(/s$/, '')), facts });
    });
  }

  return summary.length > 0 ? [{ heading: 'Summary', facts: summary }, ...sections] : sections;
}

export function buildPosStockNotificationMessage(
  saleId: number,
  warnings: PosStockNotificationWarning[],
  eventLabel = 'Sale',
): string {
  const lines = warnings.map(warning => {
    const correction = Number(warning.automaticAdjustmentQuantity ?? 0);
    const stockFacts = `recorded stock ${warning.previousOnHand}; stock from the transaction ${warning.uncappedResultingOnHand}; final stock ${warning.resultingOnHand}`;
    if (warning.reason === 'committed_stock_at_risk' && correction <= 0) {
      return `${warning.itemName}: ${stockFacts}; ${warning.quantityCommitted} committed to customer orders.`;
    }
    return `${warning.itemName}: ${stockFacts}${correction > 0 ? `; automatic correction +${correction}` : ''}.`;
  });

  return [
    `${eventLabel} #${saleId} changed stock that needs checking:`,
    ...lines.map(line => `- ${line}`),
    'Count the affected products and use a stocktake or adjustment only if the physical quantity differs.',
  ].join('\n');
}