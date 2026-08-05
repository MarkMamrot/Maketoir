const OPTIONAL_DATE_FIELDS = new Set(['expected_date', 'supplier_invoice_date']);
const ZERO_DEFAULT_FIELDS = new Set(['freight', 'discount']);

export function normalizePurchaseOrderField(field: string, value: unknown): unknown {
  if (OPTIONAL_DATE_FIELDS.has(field) && (value == null || String(value).trim() === '')) return null;
  if (ZERO_DEFAULT_FIELDS.has(field) && (value == null || String(value).trim() === '')) return 0;
  return value;
}