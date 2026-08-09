import { describe, expect, it } from 'vitest';

import { assessXeroDocumentEdit, hasXeroVisibleOrderChanges } from '../documentEditPolicy';

describe('hasXeroVisibleOrderChanges', () => {
  const existing = {
    supplier_id: 3,
    location_id: 4,
    order_date: '2026-08-09',
    notes: 'internal',
    items: [{ variant_id: 'v1', qty_ordered: 2, unit_cost: 10, discount_pct: 0, tax_rate: 0.1 }],
  };

  it('leaves operational note-only edits outside Xero control', () => {
    expect(hasXeroVisibleOrderChanges('purchase_order', existing, { notes: 'changed' }, undefined)).toBe(false);
  });

  it('detects Xero-visible header and line changes', () => {
    expect(hasXeroVisibleOrderChanges('purchase_order', existing, { supplier_id: 5 }, undefined)).toBe(true);
    expect(hasXeroVisibleOrderChanges('purchase_order', existing, {}, [
      { variant_id: 'v1', qty_ordered: 3, unit_cost: 10, discount_pct: 0, tax_rate: 0.1 },
    ])).toBe(true);
  });
});

describe('assessXeroDocumentEdit', () => {
  it.each(['DRAFT', 'SUBMITTED', 'AUTHORISED'])('allows an unpaid %s document outside lock dates', status => {
    expect(assessXeroDocumentEdit(true, {
      status, amountPaid: 0, amountCredited: 0, documentDate: '2026-08-09', periodLockDate: '2026-06-30',
    }).allowed).toBe(true);
  });

  it('allows local-only edits without requiring live Xero state', () => {
    expect(assessXeroDocumentEdit(false, null)).toEqual({ allowed: true, reason: 'local_only', message: null });
  });

  it('blocks paid, credited, terminal, locked, and unverifiable documents', () => {
    expect(assessXeroDocumentEdit(true, null).reason).toBe('unverifiable');
    expect(assessXeroDocumentEdit(true, { status: 'AUTHORISED', amountPaid: 1, amountCredited: 0, documentDate: '2026-08-09' }).reason).toBe('settled');
    expect(assessXeroDocumentEdit(true, { status: 'AUTHORISED', amountPaid: 0, amountCredited: 1, documentDate: '2026-08-09' }).reason).toBe('settled');
    expect(assessXeroDocumentEdit(true, { status: 'VOIDED', amountPaid: 0, amountCredited: 0, documentDate: '2026-08-09' }).reason).toBe('terminal_status');
    expect(assessXeroDocumentEdit(true, { status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, documentDate: '2026-06-30', periodLockDate: '2026-06-30' }).reason).toBe('locked_period');
  });
});