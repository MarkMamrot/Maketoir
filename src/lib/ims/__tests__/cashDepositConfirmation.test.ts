import { describe, expect, it } from 'vitest';

import { buildCashDepositConfirmationPlan, validateCashDepositConfirmation } from '../cashDepositConfirmation';

describe('buildCashDepositConfirmationPlan', () => {
  it('keeps preparation and bank acceptance variances separate', () => {
    expect(buildCashDepositConfirmationPlan({
      preparedTotal: '98.00',
      depositedTotal: '97.50',
      days: [
        { business_date: '2026-08-12', banking_variance: '-2.00' },
        { business_date: '2026-08-13', banking_variance: '0.00' },
      ],
    })).toEqual({
      preparationVariances: [{ businessDate: '2026-08-12', amount: -2 }],
      bankAcceptanceVariance: -0.5,
    });
  });

  it('rounds bank machine differences to cents', () => {
    expect(buildCashDepositConfirmationPlan({
      preparedTotal: 100,
      depositedTotal: 99.994,
      days: [],
    }).bankAcceptanceVariance).toBe(-0.01);
  });

  it('allows a current-day Solvantis confirmation without historical evidence', () => {
    expect(validateCashDepositConfirmation({
      accountingMethod: 'solvantis',
      lodgementDate: '2026-09-24',
      today: '2026-09-24',
      bankReference: '',
      notes: '',
    })).toBeNull();
  });

  it('requires a reference and explanation for a backdated confirmation', () => {
    expect(validateCashDepositConfirmation({
      accountingMethod: 'solvantis',
      lodgementDate: '2026-09-20',
      today: '2026-09-24',
      bankReference: '',
      notes: '',
    })).toContain('bank reference');
    expect(validateCashDepositConfirmation({
      accountingMethod: 'solvantis',
      lodgementDate: '2026-09-20',
      today: '2026-09-24',
      bankReference: 'DEP-1042',
      notes: '',
    })).toContain('explanation');
  });

  it('requires evidence for an externally recorded current-day deposit', () => {
    expect(validateCashDepositConfirmation({
      accountingMethod: 'recorded_externally',
      lodgementDate: '2026-09-24',
      today: '2026-09-24',
      bankReference: 'DEP-1042',
      notes: 'Entered manually in Xero before this record was created.',
    })).toBeNull();
  });

  it('rejects a future lodgement date', () => {
    expect(validateCashDepositConfirmation({
      accountingMethod: 'solvantis',
      lodgementDate: '2026-09-25',
      today: '2026-09-24',
      bankReference: '',
      notes: '',
    })).toContain('future');
  });

  it('rejects an impossible calendar date', () => {
    expect(validateCashDepositConfirmation({
      accountingMethod: 'solvantis',
      lodgementDate: '2026-02-31',
      today: '2026-09-24',
      bankReference: '',
      notes: '',
    })).toContain('valid lodgement date');
  });
});