import { describe, expect, it } from 'vitest';
import { closingVariance, parseClosingAmount } from '../registerClosingCorrection';

describe('closing count corrections', () => {
  it.each(['', '1.001', '1e3', '+1', '--1', null, true, Infinity, '10000000000'])('rejects invalid amount %s', value => {
    expect(parseClosingAmount(value)).toBeNull();
  });
  it.each([['0', 0], ['-18.25', -18.25], ['9999999999.99', 9999999999.99], [12.1, 12.1]])('parses %s', (value, expected) => {
    expect(parseClosingAmount(value)).toBe(expected);
  });
  it('removes the cash float once and rounds to cents', () => {
    expect(closingVariance(818, 618, 200)).toBe(0);
    expect(closingVariance(815.99, 618, 200)).toBe(-2.01);
    expect(closingVariance(-10, -12, 0)).toBe(2);
    expect(closingVariance(null, 10, 0)).toBeNull();
    expect(closingVariance(20, null, 0)).toBe(20);
  });
});
