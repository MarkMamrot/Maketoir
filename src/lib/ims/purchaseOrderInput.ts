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

export function normalizeCurrencyExchangeRate(currencyCode?: string | null, exchangeRate?: string | number | null): number {
  const cur = String(currencyCode ?? 'AUD').trim().toUpperCase();
  const raw = Number(exchangeRate ?? 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return cur === 'AUD' ? 1 : raw;
}

export function normalizeCin7CurrencyRate(currencyCode?: string | null, currencyRate?: string | number | null): number {
  const cur = String(currencyCode ?? 'AUD').trim().toUpperCase();
  const raw = Number(currencyRate ?? 1);
  if (cur === 'AUD' || !Number.isFinite(raw) || raw <= 0) return 1;
  return 1 / raw;
}

export function convertCin7BaseAmountToForeign(amount: number | string | null | undefined, currencyCode?: string | null, currencyRate?: string | number | null): number {
  const rawAmount = Number(amount ?? 0);
  const cur = String(currencyCode ?? 'AUD').trim().toUpperCase();
  if (!Number.isFinite(rawAmount) || rawAmount === 0 || cur === 'AUD') return rawAmount;
  const rawRate = Number(currencyRate ?? 1);
  if (!Number.isFinite(rawRate) || rawRate <= 0) return rawAmount;
  return rawAmount * rawRate;
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
  const exchangeRate = normalizeCin7CurrencyRate(normalizedCurrencyCode, input.exchangeRate);
  const paymentTerms = typeof input.paymentTerms === 'string' ? input.paymentTerms.trim() || null : input.paymentTerms ?? null;
  const supplierInvoiceNumber = typeof input.supplierInvoiceNumber === 'string'
    ? input.supplierInvoiceNumber.trim() || null
    : input.supplierInvoiceNumber ?? null;
  const supplierInvoiceDate = toDateOnly(input.supplierInvoiceDate ?? input.invoiceDate);

  return {
    currencyCode: normalizedCurrencyCode,
    exchangeRate,
    taxTreatment: normalizedCurrencyCode === 'AUD' ? null : 'no_tax' as const,
    paymentTerms,
    supplierInvoiceNumber,
    supplierInvoiceDate,
  };
}