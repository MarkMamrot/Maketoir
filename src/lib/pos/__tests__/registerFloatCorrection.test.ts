import { describe, expect, it } from 'vitest';
import { cashFloatSnapshot, parseOpeningFloat, renderFloatCorrectionEmail } from '../registerFloatCorrection';

describe('register float corrections', () => {
  it.each(['', ' ', '-1', '1.001', '1e2', 'Infinity', '10000000000', null, undefined, {}, true])('rejects invalid money %s', value => {
    expect(parseOpeningFloat(value)).toBeNull();
  });
  it.each([['0', 0], ['200.50', 200.5], [100, 100], ['9999999999.99', 9999999999.99]])('accepts money %s', (value, amount) => {
    expect(parseOpeningFloat(value)).toBe(amount);
  });
  it('recalculates only float-adjusted variance and preserves cash and accounting evidence', () => {
    expect(cashFloatSnapshot({ id: 8, expected_amount: '618', counted_amount: '818', opening_float: '200', xero_invoice_id: 'invoice-1' }, 250)).toEqual({
      id: 8, expected: 618, counted: 818, previousFloat: 200, previousVariance: 0, variance: -50, xeroInvoiceId: 'invoice-1',
    });
  });
  it('keeps missing counts unknown and verified zero valid', () => {
    expect(cashFloatSnapshot({ id: 8, expected_amount: null, counted_amount: null, opening_float: null, xero_invoice_id: null }, 0).variance).toBeNull();
    expect(cashFloatSnapshot({ id: 8, expected_amount: 0, counted_amount: 0, opening_float: 0, xero_invoice_id: null }, 0).variance).toBe(0);
  });
  it('escapes email content and explains manual accounting correction with old/new amounts', () => {
    const email = renderFloatCorrectionEmail({ id: 1, register_name: '<Till>', location_name: 'Sydney', session_date: '2026-10-14',
      previous_float: 200, opening_float: 250, actor_name: 'Admin', reason: '<script>oops</script>', created_at: '2026-10-14 10:00:00',
      cash: [cashFloatSnapshot({ id: 8, expected_amount: 618, counted_amount: 818, opening_float: 200, xero_invoice_id: 'inv-1' }, 250)] });
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('$200.00 -&gt; $250.00');
    expect(email.html).toContain('$0.00 -&gt; -$50.00');
    expect(email.html).toContain('manually correct');
    expect(email.html).toContain('inv-1');
  });
});
