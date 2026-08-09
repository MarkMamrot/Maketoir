import { describe, expect, it } from 'vitest';

import {
  canonicalDocumentSnapshot,
  compareDocumentSnapshots,
  fingerprintReconciliationValue,
} from '../domain';

const expected = canonicalDocumentSnapshot({
  xeroId: 'invoice-1', documentType: 'ACCREC', contactId: 'contact-1', currencyCode: 'aud',
  total: 110, compatibleStatuses: ['authorised', 'paid'], amountDue: 110, amountPaid: 0, amountCredited: 0,
});

describe('reconciliation document domain', () => {
  it('normalizes casing, money, and compatible-status ordering', () => {
    expect(expected).toMatchObject({
      documentType: 'ACCREC', currencyCode: 'AUD', total: 110,
      compatibleStatuses: ['AUTHORISED', 'PAID'],
    });
  });

  it('creates stable fingerprints independent of object key order', () => {
    expect(fingerprintReconciliationValue({ expected: 1, actual: 2 }))
      .toBe(fingerprintReconciliationValue({ actual: 2, expected: 1 }));
  });

  it('reports a missing linked document and stops speculative comparisons', () => {
    expect(compareDocumentSnapshots(expected, null)).toEqual([
      expect.objectContaining({ ruleKey: 'missing_document', severity: 'error' }),
    ]);
  });

  it('uses cent tolerance and skips expectations that are not known', () => {
    const partialExpected = canonicalDocumentSnapshot({
      ...expected, contactId: null, remainingCredit: null,
    });
    const actual = canonicalDocumentSnapshot({
      ...expected, status: 'AUTHORISED', total: 110.01, amountDue: 110.01,
      contactId: 'contact-2', remainingCredit: 45,
    });
    expect(compareDocumentSnapshots(partialExpected, actual)).toEqual([]);
  });

  it('returns only high-signal type, total, currency, contact, lifecycle, and balance mismatches', () => {
    const actual = canonicalDocumentSnapshot({
      xeroId: 'invoice-2', documentType: 'ACCPAY', contactId: 'contact-2', currencyCode: 'NZD',
      total: 120, status: 'VOIDED', amountDue: 0, amountPaid: 120, amountCredited: 5,
    });
    expect(compareDocumentSnapshots(expected, actual).map(issue => issue.ruleKey)).toEqual([
      'linked_document', 'document_type', 'total', 'currency', 'contact', 'lifecycle_state',
      'amount_due', 'amount_paid', 'amount_credited',
    ]);
  });
});