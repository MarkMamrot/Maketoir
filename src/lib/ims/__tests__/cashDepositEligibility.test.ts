import { describe, expect, it } from 'vitest';
import { buildCashDepositEligibility } from '../cashDepositEligibility';

const source = {
  id: 1,
  recon_date: '2026-07-25',
  register_id: 2,
  register_session_id: 3,
  register_name: 'Front',
  expected_amount: 100,
  counted_amount: 150,
  opening_float: 50,
  xero_invoice_id: 'invoice-1',
  xero_payment_id: 'payment-1',
  xero_payment_required: 0,
};

describe('buildCashDepositEligibility', () => {
  it('allows a paid legacy source and exposes physical custody', () => {
    const [day] = buildCashDepositEligibility({
      sources: [source], plans: [], reservedSourceIds: new Set(), openDates: new Set(),
    });
    expect(day).toMatchObject({ eligible: true, expectedCustody: 100, tillVariance: 0, legacy: true });
  });

  it('requires every corrected source action and the whole day to be ready', () => {
    const [day] = buildCashDepositEligibility({
      sources: [{ ...source, xero_payment_id: null, xero_payment_required: 1 }],
      plans: [{ eod_reconciliation_id: 1, accounting_version: 2, payment_status: 'completed', variance_status: 'error', till_variance: -5 }],
      reservedSourceIds: new Set(),
      openDates: new Set(['2026-07-25']),
    });
    expect(day.eligible).toBe(false);
    expect(day.blockers).toEqual(expect.arrayContaining([
      'One or more register sessions are still open',
      'Register reconciliation 1 has incomplete Xero cash accounting',
    ]));
  });

  it('blocks a source already reserved in another deposit', () => {
    const [day] = buildCashDepositEligibility({
      sources: [source], plans: [], reservedSourceIds: new Set([1]), openDates: new Set(),
    });
    expect(day.eligible).toBe(false);
    expect(day.sources[0].reserved).toBe(true);
  });

  it('blocks the whole day when another closed session has no cash count', () => {
    const [day] = buildCashDepositEligibility({
      sources: [source], plans: [], reservedSourceIds: new Set(), openDates: new Set(),
      incompleteDates: new Set(['2026-07-25']),
    });
    expect(day.eligible).toBe(false);
    expect(day.blockers).toContain('One or more closed register sessions have no counted Cash reconciliation');
  });
});