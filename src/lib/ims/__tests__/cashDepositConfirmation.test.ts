import { describe, expect, it } from 'vitest';

import { buildCashDepositConfirmationPlan } from '../cashDepositConfirmation';

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
});