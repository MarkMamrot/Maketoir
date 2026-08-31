import { describe, expect, it } from 'vitest';
import { visiblePosPaymentTotals } from '../posSalesPaymentSummary';

describe('POS Sales payment summaries', () => {
  it('omits payment methods that round to zero dollars and cents', () => {
    expect(visiblePosPaymentTotals({
      'No Charge': 0,
      Card: 2531.18,
      Cash: '224.45',
      Adjustment: 0.004,
    })).toEqual([
      ['Card', 2531.18],
      ['Cash', 224.45],
    ]);
  });

  it('retains non-zero positive and negative totals', () => {
    expect(visiblePosPaymentTotals({ Card: 0.01, Refund: -12.5 })).toEqual([
      ['Card', 0.01],
      ['Refund', -12.5],
    ]);
  });
});