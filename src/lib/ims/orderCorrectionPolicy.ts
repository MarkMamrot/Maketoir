import type { POStatus } from './orderLifecyclePolicy';
import { assessXeroDocumentEdit, type XeroDocumentEditState } from '../xero/documentEditPolicy';

export type PurchaseOrderUndoBlocker =
  | 'not_complete'
  | 'historical'
  | 'stale_revision'
  | 'has_payments'
  | 'has_supplier_credits'
  | 'has_shortfall_resolutions'
  | 'has_child_workflow'
  | 'insufficient_stock'
  | 'incomplete_valuation_history'
  | 'xero_unverifiable'
  | 'xero_locked_period'
  | 'xero_settled'
  | 'xero_terminal_status';

export interface PurchaseOrderUndoContext {
  status: POStatus;
  isHistorical: boolean;
  expectedUpdatedAt: string | null;
  currentUpdatedAt: string | null;
  paymentCount: number;
  completedSupplierCreditCount: number;
  settledShortfallCount: number;
  conflictingChildCount: number;
  hasSufficientStock: boolean;
  hasCompleteValuationHistory: boolean;
  hasLinkedXeroBill: boolean;
  xeroBillState: XeroDocumentEditState | null;
}

export interface PurchaseOrderUndoAssessment {
  allowed: boolean;
  blockers: Array<{ code: PurchaseOrderUndoBlocker; message: string }>;
}

export function assessPurchaseOrderUndo(context: PurchaseOrderUndoContext): PurchaseOrderUndoAssessment {
  const blockers: PurchaseOrderUndoAssessment['blockers'] = [];
  const block = (code: PurchaseOrderUndoBlocker, message: string) => blockers.push({ code, message });

  if (context.status !== 'complete') block('not_complete', 'Only a completed purchase order receipt can be undone.');
  if (context.isHistorical) block('historical', 'Historical purchase orders cannot have receipts undone.');
  if (!context.expectedUpdatedAt || context.expectedUpdatedAt !== context.currentUpdatedAt) {
    block('stale_revision', 'The purchase order changed after it was loaded. Refresh and review it before retrying.');
  }
  if (context.paymentCount > 0) block('has_payments', 'Purchase orders with recorded payments cannot have receipts undone.');
  if (context.completedSupplierCreditCount > 0) block('has_supplier_credits', 'A completed supplier credit is linked to this purchase order.');
  if (context.settledShortfallCount > 0) block('has_shortfall_resolutions', 'This purchase order has a settled shortfall resolution.');
  if (context.conflictingChildCount > 0) block('has_child_workflow', 'A child workflow already depends on this purchase order receipt.');
  if (!context.hasSufficientStock) block('insufficient_stock', 'The exact received stock is no longer available at the receiving location.');
  if (!context.hasCompleteValuationHistory) {
    block('incomplete_valuation_history', 'The receipt valuation history is incomplete and cannot be reversed safely.');
  }

  if (context.hasLinkedXeroBill) {
    const xero = assessXeroDocumentEdit(true, context.xeroBillState);
    if (!xero.allowed) {
      const code = `xero_${xero.reason}` as PurchaseOrderUndoBlocker;
      block(code, xero.message ?? 'The linked Xero bill cannot be safely voided.');
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

export class OrderCorrectionConflict extends Error {
  readonly code = 'order_correction_conflict';

  constructor(readonly blockers: PurchaseOrderUndoAssessment['blockers']) {
    super(blockers[0]?.message ?? 'The order correction cannot be completed.');
    this.name = 'OrderCorrectionConflict';
  }
}