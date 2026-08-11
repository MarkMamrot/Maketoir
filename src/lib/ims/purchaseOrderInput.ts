const OPTIONAL_DATE_FIELDS = new Set(['expected_date', 'supplier_invoice_date']);
const ZERO_DEFAULT_FIELDS = new Set(['freight', 'discount']);

function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return null;
}

export function normalizePurchaseOrderField(field: string, value: unknown): unknown {
  if (OPTIONAL_DATE_FIELDS.has(field) && (value == null || String(value).trim() === '')) return null;
  if (ZERO_DEFAULT_FIELDS.has(field) && (value == null || String(value).trim() === '')) return 0;
  return value;
}

export function normalizeCin7PurchaseOrderMetadata(input: {
  currencyCode?: string | null;
  exchangeRate?: string | number | null;
  paymentTerms?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  invoiceDate?: string | null;
} = {}) {
  const normalizedCurrencyCode = String(input.currencyCode ?? 'AUD').trim().toUpperCase() || 'AUD';
  const parsedRate = Number(input.exchangeRate ?? 1);
  const safeRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 1;
  const paymentTerms = typeof input.paymentTerms === 'string' ? input.paymentTerms.trim() || null : input.paymentTerms ?? null;
  const supplierInvoiceNumber = typeof input.supplierInvoiceNumber === 'string'
    ? input.supplierInvoiceNumber.trim() || null
    : input.supplierInvoiceNumber ?? null;
  const supplierInvoiceDate = toDateOnly(input.supplierInvoiceDate ?? input.invoiceDate);

  return {
    currencyCode: normalizedCurrencyCode,
    exchangeRate: safeRate,
    paymentTerms,
    supplierInvoiceNumber,
    supplierInvoiceDate,
  };
}