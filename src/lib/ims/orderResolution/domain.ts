import { createHash } from 'crypto';

const QUANTITY_SCALE = 10_000;

export type OrderResolutionOutcome = 'leave_partial' | 'cancel_remainder' | 'create_backorder';
export type CreditSettlement = 'none' | 'refund' | 'leave_unapplied' | 'reserve_for_backorder';
export type TaxTreatment = 'ex_tax' | 'inc_tax' | 'no_tax';

export type OutstandingOrderLine = {
  itemId: number;
  orderedQuantity: number;
  actualQuantity: number;
  outstandingQuantity: number;
  unitAmount: number;
  discountPct: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
};

export type AccountingResolution =
  | { kind: 'local_only'; requiresCreditNote: false }
  | { kind: 'resize_xero_document'; requiresCreditNote: false }
  | { kind: 'create_credit_note'; requiresCreditNote: true }
  | { kind: 'blocked'; requiresCreditNote: false; code: string; message: string };

type OrderLineInput = {
  itemId: number;
  orderedQuantity: number;
  actualQuantity: number;
  unitAmount: number;
  discountPct?: number | null;
  taxRate?: number | null;
};

type XeroDocumentState = {
  documentId: string | null;
  status: string | null;
  amountPaid: number;
  amountCredited: number;
  quantitiesEditable: boolean;
};

function scaledQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Quantities must be finite numbers.');
  return Math.round(value * QUANTITY_SCALE);
}

function cents(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Monetary amounts must be finite numbers.');
  return Math.round(value * 100);
}

function money(valueInCents: number): number {
  return valueInCents / 100;
}

export function calculateOutstandingLines(
  lines: OrderLineInput[],
  taxTreatment: TaxTreatment,
): OutstandingOrderLine[] {
  return lines.flatMap(line => {
    const ordered = scaledQuantity(line.orderedQuantity);
    const actual = scaledQuantity(line.actualQuantity);
    if (ordered <= 0) throw new Error('Ordered quantity must be greater than zero.');
    if (actual < 0) throw new Error('Actual quantity cannot be negative.');
    if (actual > ordered) throw new Error('Actual quantity cannot exceed ordered quantity.');

    const outstanding = ordered - actual;
    if (outstanding === 0) return [];

    const unitAmount = Number(line.unitAmount);
    const discountPct = Number(line.discountPct ?? 0);
    const taxRate = Number(line.taxRate ?? 0);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) throw new Error('Unit amount must be a non-negative number.');
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      throw new Error('Discount percentage must be between zero and 100.');
    }
    if (!Number.isFinite(taxRate) || taxRate < 0) throw new Error('Tax rate must be a non-negative number.');

    const discountedLine = (outstanding / QUANTITY_SCALE) * unitAmount * (1 - discountPct / 100);
    let subtotalCents: number;
    let taxCents = 0;
    if (taxTreatment === 'inc_tax' && taxRate > 0) {
      subtotalCents = cents(discountedLine / (1 + taxRate));
      taxCents = cents(discountedLine) - subtotalCents;
    } else {
      subtotalCents = cents(discountedLine);
      if (taxTreatment === 'ex_tax') taxCents = cents(discountedLine * taxRate);
    }

    return [{
      itemId: line.itemId,
      orderedQuantity: ordered / QUANTITY_SCALE,
      actualQuantity: actual / QUANTITY_SCALE,
      outstandingQuantity: outstanding / QUANTITY_SCALE,
      unitAmount,
      discountPct,
      taxRate,
      subtotal: money(subtotalCents),
      taxAmount: money(taxCents),
      totalAmount: money(subtotalCents + taxCents),
    }];
  });
}

export function calculateOutstandingTotals(lines: OutstandingOrderLine[]): {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
} {
  const subtotalCents = lines.reduce((sum, line) => sum + cents(line.subtotal), 0);
  const taxCents = lines.reduce((sum, line) => sum + cents(line.taxAmount), 0);
  return {
    subtotal: money(subtotalCents),
    taxAmount: money(taxCents),
    totalAmount: money(subtotalCents + taxCents),
  };
}

export function classifyAccountingResolution(
  outcome: OrderResolutionOutcome,
  xero: XeroDocumentState,
): AccountingResolution {
  if (outcome === 'leave_partial' || !xero.documentId) {
    return { kind: 'local_only', requiresCreditNote: false };
  }

  const status = String(xero.status ?? '').trim().toUpperCase();
  if (!status || ['DELETED', 'VOIDED'].includes(status)) {
    return {
      kind: 'blocked',
      requiresCreditNote: false,
      code: 'xero_document_unavailable',
      message: `The linked Xero document is ${status || 'unavailable'} and must be reconciled before resolving the remainder.`,
    };
  }

  const hasFinancialActivity = cents(xero.amountPaid) !== 0 || cents(xero.amountCredited) !== 0;
  if (!hasFinancialActivity && xero.quantitiesEditable && ['DRAFT', 'AUTHORISED'].includes(status)) {
    return { kind: 'resize_xero_document', requiresCreditNote: false };
  }

  if (['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(status)) {
    return { kind: 'create_credit_note', requiresCreditNote: true };
  }

  return {
    kind: 'blocked',
    requiresCreditNote: false,
    code: 'xero_status_unsupported',
    message: `The linked Xero document status ${status} is not supported for automatic resolution.`,
  };
}

export function allowedCreditSettlements(
  outcome: OrderResolutionOutcome,
  accounting: AccountingResolution,
): CreditSettlement[] {
  if (accounting.kind !== 'create_credit_note') return ['none'];
  const settlements: CreditSettlement[] = ['refund', 'leave_unapplied'];
  if (outcome === 'create_backorder') settlements.push('reserve_for_backorder');
  return settlements;
}

export function createResolutionOperationKey(input: {
  side: 'customer' | 'supplier';
  orderId: number;
  outcome: OrderResolutionOutcome;
  lines: Array<{ itemId: number; actualQuantity: number }>;
}): string {
  const canonicalLines = [...input.lines]
    .map(line => ({ itemId: line.itemId, actualQuantity: scaledQuantity(line.actualQuantity) }))
    .sort((left, right) => left.itemId - right.itemId);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ side: input.side, orderId: input.orderId, outcome: input.outcome, lines: canonicalLines }))
    .digest('hex')
    .slice(0, 32);
  return `shortfall:${input.side}:${input.orderId}:${fingerprint}`;
}