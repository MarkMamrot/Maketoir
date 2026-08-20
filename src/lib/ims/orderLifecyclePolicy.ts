export type OrderKind = 'purchase_order' | 'sales_order';
export type SalesDocumentType = 'sales-order' | 'pro-forma' | 'tax-invoice';

export type POStatus = 'draft' | 'confirmed' | 'partially_received' | 'backordered' | 'complete' | 'cancelled';
export type SOStatus = 'draft' | 'confirmed' | 'partially_fulfilled' | 'backordered' | 'fulfilled' | 'cancelled';
export type OrderStatus = POStatus | SOStatus;

const PO_TRANSITIONS: Record<POStatus, readonly POStatus[]> = {
  draft: ['confirmed'],
  confirmed: ['draft', 'cancelled'],
  partially_received: ['complete'],
  backordered: ['confirmed', 'cancelled'],
  complete: [],
  cancelled: [],
};

const SO_TRANSITIONS: Record<SOStatus, readonly SOStatus[]> = {
  draft: ['confirmed'],
  confirmed: ['draft', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled', 'cancelled'],
  backordered: ['confirmed', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

export class OrderLifecycleConflict extends Error {
  readonly code = 'order_lifecycle_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'OrderLifecycleConflict';
  }
}

export function isAllowedPOStatusTransition(from: POStatus, to: POStatus): boolean {
  return from === to || PO_TRANSITIONS[from].includes(to);
}

export function isAllowedSOStatusTransition(from: SOStatus, to: SOStatus): boolean {
  return from === to || SO_TRANSITIONS[from].includes(to);
}

export function assertAllowedPOStatusTransition(from: POStatus, to: POStatus): void {
  if (!isAllowedPOStatusTransition(from, to)) {
    throw new OrderLifecycleConflict(`Purchase order cannot change from ${from} to ${to}.`);
  }
}

export function assertAllowedSOStatusTransition(from: SOStatus, to: SOStatus): void {
  if (!isAllowedSOStatusTransition(from, to)) {
    throw new OrderLifecycleConflict(`Sales order cannot change from ${from} to ${to}.`);
  }
}

export function getOrderStatusLabel(kind: OrderKind, status: OrderStatus): string {
  if ((kind === 'purchase_order' && status === 'complete') ||
      (kind === 'sales_order' && status === 'fulfilled')) {
    return 'Completed';
  }
  if ((kind === 'purchase_order' && status === 'partially_received') ||
      (kind === 'sales_order' && status === 'partially_fulfilled')) {
    return 'In Progress';
  }

  return status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getPhysicalCompletionLabel(kind: OrderKind): string {
  return kind === 'purchase_order' ? 'Fully received' : 'Fully fulfilled';
}

export function isSalesDocumentAvailable(document: SalesDocumentType, status: SOStatus): boolean {
  if (document === 'sales-order') return true;
  if (document === 'tax-invoice') return status === 'fulfilled';
  return status !== 'fulfilled' && status !== 'cancelled';
}

export function getDefaultEmailedSalesDocument(status: SOStatus): SalesDocumentType | null {
  if (status === 'fulfilled') return 'tax-invoice';
  if (status === 'cancelled') return null;
  return 'pro-forma';
}

export function parseSalesDocumentType(value: string | null): SalesDocumentType | null {
  return value === 'sales-order' || value === 'pro-forma' || value === 'tax-invoice' ? value : null;
}

export function getSalesDocumentTitle(document: SalesDocumentType): string {
  if (document === 'sales-order') return 'SALES ORDER';
  if (document === 'pro-forma') return 'PRO FORMA INVOICE';
  return 'TAX INVOICE';
}

export function getSalesDocumentFilename(
  document: SalesDocumentType,
  salesOrderNumber: string,
  xeroInvoiceNumber?: string | null,
): string {
  const safeOrderNumber = salesOrderNumber.replace(/[^a-z0-9_-]+/gi, '-');
  if (document === 'sales-order') return safeOrderNumber;
  if (document === 'pro-forma') return `PROFORMA-${safeOrderNumber}`;
  const safeInvoiceNumber = String(xeroInvoiceNumber ?? '').trim().replace(/[^a-z0-9_-]+/gi, '-');
  return safeInvoiceNumber || `TAX-INVOICE-${safeOrderNumber}`;
}

export function buildOrderStatusOperationKey(
  kind: OrderKind,
  orderId: number,
  status: OrderStatus,
  updatedAt: string | null | undefined,
): string {
  const revision = String(updatedAt ?? '').trim() || 'unversioned';
  return `${kind}:${orderId}:status:${status}:revision:${revision}`;
}

export function buildPurchaseOrderUndoOperationKey(
  orderId: number,
  updatedAt: string | null | undefined,
): string {
  const revision = String(updatedAt ?? '').trim() || 'unversioned';
  return `purchase_order:${orderId}:undo_mistaken_receipt:revision:${revision}`;
}

export async function buildPurchaseOrderReceiveOperationKey(
  orderId: number,
  updatedAt: string | null | undefined,
  payload: unknown,
): Promise<string> {
  const revision = String(updatedAt ?? '').trim() || 'unversioned';
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const requestHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `purchase_order:${orderId}:receive:revision:${revision}:request:${requestHash}`;
}

export async function buildOrderEditOperationKey(
  kind: OrderKind,
  orderId: number,
  updatedAt: string | null | undefined,
  payload: unknown,
): Promise<string> {
  const revision = String(updatedAt ?? '').trim() || 'unversioned';
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const requestHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${kind}:${orderId}:edit:revision:${revision}:request:${requestHash}`;
}