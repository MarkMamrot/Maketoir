import { describe, expect, it } from 'vitest';

import { assessPurchaseOrderUndo } from '../orderCorrectionPolicy';

const eligible = {
  status: 'complete' as const,
  isHistorical: false,
  expectedUpdatedAt: '2026-03-01T00:00:00.000Z',
  currentUpdatedAt: '2026-03-01T00:00:00.000Z',
  paymentCount: 0,
  completedSupplierCreditCount: 0,
  settledShortfallCount: 0,
  conflictingChildCount: 0,
  hasSufficientStock: true,
  hasCompleteValuationHistory: true,
  hasLinkedXeroBill: false,
  xeroBillState: null,
};

describe('assessPurchaseOrderUndo', () => {
  it('allows a current non-historical completed PO with reversible stock and no linked bill', () => {
    expect(assessPurchaseOrderUndo(eligible)).toEqual({ allowed: true, blockers: [] });
  });

  it('reports lifecycle, dependency, stock, and valuation blockers together', () => {
    const assessment = assessPurchaseOrderUndo({
      ...eligible,
      status: 'confirmed',
      isHistorical: true,
      currentUpdatedAt: '2026-03-02T00:00:00.000Z',
      paymentCount: 1,
      completedSupplierCreditCount: 1,
      settledShortfallCount: 1,
      conflictingChildCount: 1,
      hasSufficientStock: false,
      hasCompleteValuationHistory: false,
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.blockers.map(blocker => blocker.code)).toEqual([
      'not_complete',
      'historical',
      'stale_revision',
      'has_payments',
      'has_supplier_credits',
      'has_shortfall_resolutions',
      'has_child_workflow',
      'insufficient_stock',
      'incomplete_valuation_history',
    ]);
  });

  it.each([
    [null, 'xero_unverifiable'],
    [{ status: 'AUTHORISED', amountPaid: 10, amountCredited: 0, documentDate: '2026-03-01' }, 'xero_settled'],
    [{ status: 'PAID', amountPaid: 0, amountCredited: 0, documentDate: '2026-03-01' }, 'xero_terminal_status'],
    [{ status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, documentDate: '2026-03-01', periodLockDate: '2026-03-01' }, 'xero_locked_period'],
  ])('blocks an unsafe linked Xero bill state', (xeroBillState, expectedCode) => {
    const assessment = assessPurchaseOrderUndo({ ...eligible, hasLinkedXeroBill: true, xeroBillState });
    expect(assessment.blockers[0]?.code).toBe(expectedCode);
  });

  it.each(['DRAFT', 'SUBMITTED', 'AUTHORISED'])('allows an unpaid, unlocked %s Xero bill', status => {
    const assessment = assessPurchaseOrderUndo({
      ...eligible,
      hasLinkedXeroBill: true,
      xeroBillState: { status, amountPaid: 0, amountCredited: 0, documentDate: '2026-03-01' },
    });
    expect(assessment.allowed).toBe(true);
  });
});