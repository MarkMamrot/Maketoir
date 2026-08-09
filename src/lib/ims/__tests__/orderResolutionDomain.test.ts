import { describe, expect, it } from 'vitest';
import {
  allowedCreditSettlements,
  calculateOutstandingLines,
  calculateOutstandingTotals,
  classifyAccountingResolution,
  createResolutionOperationKey,
} from '../orderResolution/domain';

describe('outstanding order resolution domain', () => {
  it('calculates the tax-inclusive $30 shortfall from a $100 order with $70 supplied', () => {
    const lines = calculateOutstandingLines([{
      itemId: 1,
      orderedQuantity: 10,
      actualQuantity: 7,
      unitAmount: 10,
      taxRate: 0.1,
    }], 'inc_tax');

    expect(lines).toEqual([expect.objectContaining({
      outstandingQuantity: 3,
      subtotal: 27.27,
      taxAmount: 2.73,
      totalAmount: 30,
    })]);
    expect(calculateOutstandingTotals(lines)).toEqual({ subtotal: 27.27, taxAmount: 2.73, totalAmount: 30 });
  });

  it('applies line discount before exclusive tax and excludes fully supplied lines', () => {
    const lines = calculateOutstandingLines([
      { itemId: 1, orderedQuantity: 5, actualQuantity: 3, unitAmount: 20, discountPct: 10, taxRate: 0.1 },
      { itemId: 2, orderedQuantity: 1, actualQuantity: 1, unitAmount: 50, taxRate: 0.1 },
    ], 'ex_tax');

    expect(lines).toEqual([expect.objectContaining({
      itemId: 1,
      outstandingQuantity: 2,
      subtotal: 36,
      taxAmount: 3.6,
      totalAmount: 39.6,
    })]);
  });

  it('rejects invalid quantity boundaries', () => {
    expect(() => calculateOutstandingLines([
      { itemId: 1, orderedQuantity: 2, actualQuantity: 3, unitAmount: 10 },
    ], 'no_tax')).toThrow('cannot exceed');
  });

  it('resizes unpaid editable Xero documents and credits documents with financial activity', () => {
    expect(classifyAccountingResolution('cancel_remainder', {
      documentId: 'invoice-1', status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, quantitiesEditable: true,
    })).toEqual({ kind: 'resize_xero_document', requiresCreditNote: false });

    expect(classifyAccountingResolution('create_backorder', {
      documentId: 'invoice-1', status: 'PAID', amountPaid: 100, amountCredited: 0, quantitiesEditable: false,
    })).toEqual({ kind: 'create_credit_note', requiresCreditNote: true });
  });

  it('offers future allocation only when a child order will exist', () => {
    const credit = { kind: 'create_credit_note', requiresCreditNote: true } as const;
    expect(allowedCreditSettlements('cancel_remainder', credit)).toEqual(['refund', 'leave_unapplied']);
    expect(allowedCreditSettlements('create_backorder', credit)).toEqual([
      'refund', 'leave_unapplied', 'reserve_for_backorder',
    ]);
    expect(allowedCreditSettlements('leave_partial', { kind: 'local_only', requiresCreditNote: false })).toEqual(['none']);
  });

  it('creates a deterministic operation key independent of line order', () => {
    const base = {
      side: 'customer' as const,
      orderId: 42,
      outcome: 'create_backorder' as const,
    };
    expect(createResolutionOperationKey({
      ...base,
      lines: [{ itemId: 2, actualQuantity: 1 }, { itemId: 1, actualQuantity: 7 }],
    })).toBe(createResolutionOperationKey({
      ...base,
      lines: [{ itemId: 1, actualQuantity: 7 }, { itemId: 2, actualQuantity: 1 }],
    }));
  });
});