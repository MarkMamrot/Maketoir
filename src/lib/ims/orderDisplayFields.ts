export const DEFAULT_SALES_ORDER_DISPLAY_FIELDS = [
  'so_number', 'customer_name', 'channel_order_number', 'sales_channel',
  'location_name', 'status', 'order_date', 'total_amount',
] as const;

export const DEFAULT_PURCHASE_ORDER_DISPLAY_FIELDS = [
  'po_number', 'supplier_name', 'supplier_invoice_number', 'location_name',
  'status', 'order_date', 'expected_date', 'total_amount',
] as const;

export function sanitizeOrderDisplayFieldSelection(
  selectedIds: unknown,
  fields: readonly { id: string; required?: boolean }[],
  defaultIds: readonly string[],
): string[] {
  const allowed = new Set(fields.map(field => field.id));
  const required = fields.filter(field => field.required).map(field => field.id);
  const requested = Array.isArray(selectedIds) ? selectedIds : defaultIds;
  return [...new Set([
    ...required,
    ...requested.filter((id): id is string => typeof id === 'string' && allowed.has(id)),
  ])];
}
