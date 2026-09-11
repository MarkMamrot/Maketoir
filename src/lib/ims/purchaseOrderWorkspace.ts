export type PurchaseOrderDateRange =
  | { kind: 'window'; window: number; label: string }
  | { kind: 'range'; from: string; to: string; label: string };

export interface PurchaseOrderWorkspaceSettings {
  status: string;
  supplier: string;
  product: string;
  dateRange: PurchaseOrderDateRange;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
}

const STATUSES = new Set(['', 'draft', 'confirmed', 'partially_received', 'backordered', 'complete', 'cancelled']);
const SORT_COLUMNS = new Set([
  'po_number', 'supplier_name', 'supplier_invoice_number', 'location_name', 'status', 'payment_terms', 'notes',
  'order_date', 'expected_date', 'received_date', 'subtotal', 'tax_amount', 'freight', 'discount', 'total_amount',
  'amount_paid', 'balance', 'currency_code', 'exchange_rate',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_PURCHASE_ORDER_WORKSPACE: PurchaseOrderWorkspaceSettings = {
  status: '',
  supplier: '',
  product: '',
  dateRange: { kind: 'window', window: 90, label: '90 Days' },
  sortColumn: 'order_date',
  sortDirection: 'desc',
};

function sanitizeDateRange(value: unknown): PurchaseOrderDateRange {
  if (!value || typeof value !== 'object') return DEFAULT_PURCHASE_ORDER_WORKSPACE.dateRange;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'range') {
    const from = String(raw.from ?? '');
    const to = String(raw.to ?? '');
    if (DATE_PATTERN.test(from) && DATE_PATTERN.test(to)) {
      return { kind: 'range', from, to, label: String(raw.label ?? 'Custom Range').slice(0, 80) || 'Custom Range' };
    }
  }
  if (raw.kind === 'window') {
    const window = Number(raw.window);
    if (Number.isInteger(window) && window >= 1 && window <= 3650) {
      return { kind: 'window', window, label: String(raw.label ?? `${window} Days`).slice(0, 80) || `${window} Days` };
    }
  }
  return DEFAULT_PURCHASE_ORDER_WORKSPACE.dateRange;
}

export function sanitizePurchaseOrderWorkspace(value: unknown): PurchaseOrderWorkspaceSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const status = String(raw.status ?? '');
  const sortColumn = String(raw.sortColumn ?? '');
  return {
    status: STATUSES.has(status) ? status : DEFAULT_PURCHASE_ORDER_WORKSPACE.status,
    supplier: String(raw.supplier ?? '').trim().slice(0, 255),
    product: String(raw.product ?? '').trim().slice(0, 255),
    dateRange: sanitizeDateRange(raw.dateRange),
    sortColumn: SORT_COLUMNS.has(sortColumn) ? sortColumn : DEFAULT_PURCHASE_ORDER_WORKSPACE.sortColumn,
    sortDirection: raw.sortDirection === 'asc' ? 'asc' : 'desc',
  };
}