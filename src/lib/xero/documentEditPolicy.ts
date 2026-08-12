export type XeroOrderDocumentType = 'purchase_order' | 'sales_order';
export type XeroCreditNoteDocumentType = 'customer_credit_note' | 'supplier_credit_note';

export interface XeroDocumentEditState {
  status: string | null;
  amountPaid: number;
  amountCredited: number;
  documentDate: string | null;
  periodLockDate?: string | null;
  endOfYearLockDate?: string | null;
}

export interface XeroDocumentEditAssessment {
  allowed: boolean;
  reason: 'editable' | 'local_only' | 'unverifiable' | 'locked_period' | 'settled' | 'terminal_status';
  message: string | null;
}

export interface XeroCreditNoteEditState {
  status: string | null;
  total: number;
  remainingCredit: number;
  documentDate: string | null;
  periodLockDate?: string | null;
  endOfYearLockDate?: string | null;
}

const PO_XERO_FIELDS = [
  'supplier_id', 'location_id', 'order_date', 'supplier_invoice_number',
  'supplier_invoice_date', 'payment_terms', 'tax_treatment', 'tax_code',
  'currency_code', 'exchange_rate', 'freight', 'discount',
] as const;

const SO_XERO_FIELDS = [
  'customer_id', 'location_id', 'order_date', 'payment_terms', 'tax_treatment',
  'tax_code', 'currency_code', 'exchange_rate', 'freight', 'discount',
] as const;

const CUSTOMER_CN_XERO_FIELDS = [
  'customer_id', 'location_id', 'cn_date', 'reference', 'tax_treatment', 'tax_code',
] as const;

const SUPPLIER_CN_XERO_FIELDS = [
  'supplier_id', 'location_id', 'scn_date', 'reference', 'supplier_credit_ref',
  'currency_code', 'exchange_rate', 'tax_treatment', 'tax_code',
] as const;

function canonicalScalar(value: unknown): string | number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  const numeric = Number(text);
  return text !== '' && Number.isFinite(numeric) ? numeric : text.slice(0, 10) === text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text;
}

function canonicalItems(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return JSON.stringify(items.map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      variant_id: canonicalScalar(row.variant_id),
      qty_ordered: canonicalScalar(row.qty_ordered),
      unit_cost: canonicalScalar(row.unit_cost),
      unit_price: canonicalScalar(row.unit_price),
      discount_pct: canonicalScalar(row.discount_pct),
      tax_rate: canonicalScalar(row.tax_rate),
      line_total: canonicalScalar(row.line_total),
    };
  }));
}

function canonicalCreditNoteItems(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return JSON.stringify(items.map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      variant_id: canonicalScalar(row.variant_id),
      code: canonicalScalar(row.code),
      name: canonicalScalar(row.name ?? row.product_name),
      qty: canonicalScalar(row.qty),
      unit_price: canonicalScalar(row.unit_price),
      unit_cost: canonicalScalar(row.unit_cost),
      tax_rate: canonicalScalar(row.tax_rate),
      restock: canonicalScalar(row.restock),
    };
  }));
}

export function hasXeroVisibleOrderChanges(
  type: XeroOrderDocumentType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  incomingItems: unknown,
): boolean {
  const fields = type === 'purchase_order' ? PO_XERO_FIELDS : SO_XERO_FIELDS;
  if (fields.some(field => field in incoming && canonicalScalar(existing[field]) !== canonicalScalar(incoming[field]))) {
    return true;
  }
  return incomingItems !== undefined && canonicalItems(existing.items) !== canonicalItems(incomingItems);
}

export function hasXeroVisibleCreditNoteChanges(
  type: XeroCreditNoteDocumentType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  incomingItems: unknown,
): boolean {
  const fields = type === 'customer_credit_note' ? CUSTOMER_CN_XERO_FIELDS : SUPPLIER_CN_XERO_FIELDS;
  if (fields.some(field => field in incoming && canonicalScalar(existing[field]) !== canonicalScalar(incoming[field]))) {
    return true;
  }
  return incomingItems !== undefined
    && canonicalCreditNoteItems(existing.items) !== canonicalCreditNoteItems(incomingItems);
}

function latestLockDate(state: { periodLockDate?: string | null; endOfYearLockDate?: string | null }): string | null {
  const dates = [state.periodLockDate, state.endOfYearLockDate]
    .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  return dates.sort().at(-1) ?? null;
}

export function assessXeroDocumentEdit(
  hasXeroVisibleChanges: boolean,
  state: XeroDocumentEditState | null,
): XeroDocumentEditAssessment {
  if (!hasXeroVisibleChanges) return { allowed: true, reason: 'local_only', message: null };
  if (!state?.status) {
    return { allowed: false, reason: 'unverifiable', message: 'The linked Xero document could not be verified.' };
  }

  const status = state.status.toUpperCase();
  if (['VOIDED', 'DELETED', 'PAID'].includes(status)) {
    return { allowed: false, reason: 'terminal_status', message: `The linked Xero document is ${status}.` };
  }
  if (state.amountPaid > 0.005 || state.amountCredited > 0.005) {
    return { allowed: false, reason: 'settled', message: 'The linked Xero document has payments or credits applied.' };
  }

  const lockDate = latestLockDate(state);
  if (lockDate && state.documentDate && state.documentDate.slice(0, 10) <= lockDate) {
    return { allowed: false, reason: 'locked_period', message: `The linked Xero document is dated in a locked period ending ${lockDate}.` };
  }
  if (!['DRAFT', 'SUBMITTED', 'AUTHORISED'].includes(status)) {
    return { allowed: false, reason: 'terminal_status', message: `The linked Xero document status ${status} cannot be edited safely.` };
  }
  return { allowed: true, reason: 'editable', message: null };
}

export function assessXeroCreditNoteEdit(
  hasXeroVisibleChanges: boolean,
  state: XeroCreditNoteEditState | null,
): XeroDocumentEditAssessment {
  if (!hasXeroVisibleChanges) return { allowed: true, reason: 'local_only', message: null };
  if (!state?.status) {
    return { allowed: false, reason: 'unverifiable', message: 'The linked Xero credit note could not be verified.' };
  }

  const status = state.status.toUpperCase();
  if (['PAID', 'VOIDED', 'DELETED'].includes(status)) {
    return { allowed: false, reason: 'terminal_status', message: `The linked Xero credit note is ${status}.` };
  }
  if (state.total > 0.005 && state.remainingCredit < state.total - 0.005) {
    return { allowed: false, reason: 'settled', message: 'The linked Xero credit note has allocations or refunds applied.' };
  }

  const lockDate = latestLockDate(state);
  if (lockDate && state.documentDate && state.documentDate.slice(0, 10) <= lockDate) {
    return { allowed: false, reason: 'locked_period', message: `The linked Xero credit note is dated in a locked period ending ${lockDate}.` };
  }
  if (status !== 'DRAFT') {
    return { allowed: false, reason: 'terminal_status', message: `The linked Xero credit note is ${status} and cannot be edited from this Draft.` };
  }
  return { allowed: true, reason: 'editable', message: null };
}

export function assessXeroCreditNoteVoid(
  state: XeroCreditNoteEditState | null,
): XeroDocumentEditAssessment {
  if (!state?.status) {
    return { allowed: false, reason: 'unverifiable', message: 'The linked Xero credit note could not be verified.' };
  }

  const status = state.status.toUpperCase();
  if (['VOIDED', 'DELETED'].includes(status)) {
    return { allowed: true, reason: 'local_only', message: null };
  }
  if (status === 'PAID' || (state.total > 0.005 && state.remainingCredit < state.total - 0.005)) {
    return { allowed: false, reason: 'settled', message: 'The linked Xero credit note has allocations or refunds applied.' };
  }

  const lockDate = latestLockDate(state);
  if (lockDate && state.documentDate && state.documentDate.slice(0, 10) <= lockDate) {
    return { allowed: false, reason: 'locked_period', message: `The linked Xero credit note is dated in a locked period ending ${lockDate}.` };
  }
  if (!['DRAFT', 'SUBMITTED', 'AUTHORISED'].includes(status)) {
    return { allowed: false, reason: 'terminal_status', message: `The linked Xero credit note status ${status} cannot be voided safely.` };
  }
  return { allowed: true, reason: 'editable', message: null };
}