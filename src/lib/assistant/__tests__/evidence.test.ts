import { describe, expect, it } from 'vitest';

import { failedToolEvidence, successfulToolEvidence } from '../evidence';

describe('assistant tool evidence', () => {
  it('distinguishes an empty successful lookup from an operational failure', () => {
    expect(successfulToolEvidence([])).toEqual({
      status: 'no_results',
      facts: [],
      message: 'The authorised lookup completed but found no matching records.',
      truncated: false,
    });
    expect(failedToolEvidence('operational_error', ' Database unavailable ')).toEqual({
      status: 'operational_error',
      facts: null,
      message: 'Database unavailable',
      truncated: false,
    });
  });

  it('preserves successful facts', () => {
    expect(successfulToolEvidence([{ reference: 'SO-1' }])).toEqual({
      status: 'ok',
      facts: [{ reference: 'SO-1' }],
      message: null,
      truncated: false,
    });
  });

  it('removes nested sensitive fields while preserving operational evidence', () => {
    expect(successfulToolEvidence({
      contactId: 21,
      customerCode: 'C-21',
      rows: [{
        supplier: 'Acme',
        supplier_email: 'private@example.com',
        paymentMethods: [{ method: 'Cash', amount: 20, payment_reference: 'secret-ref' }],
        notes: 'Private free text',
        actorName: 'Private Staff',
      }],
    }).facts).toEqual({
      contactId: 21,
      customerCode: 'C-21',
      rows: [{
        supplier: 'Acme',
        paymentMethods: [{ method: 'Cash', amount: 20 }],
      }],
    });
  });

  it('marks a result that reaches its declared row cap as truncated', () => {
    expect(successfulToolEvidence([{ id: 1 }, { id: 2 }], 2).truncated).toBe(true);
    expect(successfulToolEvidence({ activity: [], truncated: true }).truncated).toBe(true);
  });
});
