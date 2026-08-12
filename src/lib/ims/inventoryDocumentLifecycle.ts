export type InventoryDocumentKind = 'customer_credit_note' | 'supplier_credit_note' | 'stocktake';

export type CustomerCreditNoteStatus = 'draft' | 'awaiting_product' | 'complete' | 'cancelled' | 'reversed';
export type SupplierCreditNoteStatus = 'draft' | 'complete' | 'cancelled' | 'reversed';
export type StocktakeStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'reverted';
export type InventoryDocumentStatus = CustomerCreditNoteStatus | SupplierCreditNoteStatus | StocktakeStatus;

export type CustomerCreditNoteSource = 'manual' | 'shopify' | 'pos' | 'so_shortfall';

export type InventoryDocumentAction =
  | 'edit'
  | 'delete'
  | 'mark_awaiting_product'
  | 'resume_draft'
  | 'complete'
  | 'cancel'
  | 'start'
  | 'revert_mistaken_completion';

type ActionPolicy = Partial<Record<InventoryDocumentAction, InventoryDocumentStatus>>;

const CUSTOMER_CREDIT_NOTE_ACTIONS: Record<CustomerCreditNoteStatus, ActionPolicy> = {
  draft: {
    edit: 'draft',
    delete: 'draft',
    mark_awaiting_product: 'awaiting_product',
    complete: 'complete',
    cancel: 'cancelled',
  },
  awaiting_product: {
    resume_draft: 'draft',
    complete: 'complete',
    cancel: 'cancelled',
  },
  complete: { revert_mistaken_completion: 'reversed' },
  cancelled: {},
  reversed: {},
};

const SUPPLIER_CREDIT_NOTE_ACTIONS: Record<SupplierCreditNoteStatus, ActionPolicy> = {
  draft: {
    edit: 'draft',
    delete: 'draft',
    complete: 'complete',
    cancel: 'cancelled',
  },
  complete: { revert_mistaken_completion: 'reversed' },
  cancelled: {},
  reversed: {},
};

const STOCKTAKE_ACTIONS: Record<StocktakeStatus, ActionPolicy> = {
  draft: {
    edit: 'draft',
    delete: 'draft',
    start: 'in_progress',
    cancel: 'cancelled',
  },
  in_progress: {
    edit: 'in_progress',
    complete: 'completed',
    cancel: 'cancelled',
  },
  completed: { revert_mistaken_completion: 'reverted' },
  cancelled: {},
  reverted: {},
};

export class InventoryDocumentLifecycleConflict extends Error {
  readonly code = 'inventory_document_lifecycle_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'InventoryDocumentLifecycleConflict';
  }
}

function getPolicy(kind: InventoryDocumentKind, status: InventoryDocumentStatus): ActionPolicy | undefined {
  if (kind === 'customer_credit_note') {
    return CUSTOMER_CREDIT_NOTE_ACTIONS[status as CustomerCreditNoteStatus];
  }
  if (kind === 'supplier_credit_note') {
    return SUPPLIER_CREDIT_NOTE_ACTIONS[status as SupplierCreditNoteStatus];
  }
  return STOCKTAKE_ACTIONS[status as StocktakeStatus];
}

export function getInventoryDocumentActionTarget(
  kind: InventoryDocumentKind,
  status: InventoryDocumentStatus,
  action: InventoryDocumentAction,
  options: { customerCreditNoteSource?: CustomerCreditNoteSource } = {},
): InventoryDocumentStatus | null {
  if (
    kind === 'customer_credit_note' &&
    action === 'revert_mistaken_completion' &&
    options.customerCreditNoteSource !== 'manual'
  ) {
    return null;
  }

  return getPolicy(kind, status)?.[action] ?? null;
}

export function assertAllowedInventoryDocumentAction(
  kind: InventoryDocumentKind,
  status: InventoryDocumentStatus,
  action: InventoryDocumentAction,
  options: { customerCreditNoteSource?: CustomerCreditNoteSource } = {},
): InventoryDocumentStatus {
  const target = getInventoryDocumentActionTarget(kind, status, action, options);
  if (!target) {
    throw new InventoryDocumentLifecycleConflict(
      `${kind.replaceAll('_', ' ')} cannot perform ${action.replaceAll('_', ' ')} from ${status.replaceAll('_', ' ')}.`,
    );
  }
  return target;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export async function hashInventoryDocumentRequest(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(payload)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildInventoryDocumentOperationKey(
  kind: InventoryDocumentKind,
  documentId: number,
  action: InventoryDocumentAction,
  updatedAt: string | null | undefined,
  payload: unknown = {},
): Promise<string> {
  const revision = String(updatedAt ?? '').trim() || 'unversioned';
  const requestHash = await hashInventoryDocumentRequest(payload);
  return `${kind}:${documentId}:${action}:revision:${revision}:request:${requestHash}`;
}