import { describe, expect, it } from 'vitest';
import { formatReceiptDate } from '../receiptDate';

describe('formatReceiptDate', () => {
  it('converts an ISO UTC instant to the business timezone', () => {
    expect(formatReceiptDate('2026-08-06T02:15:00.000Z', 'Australia/Sydney')).toBe('6/8/26, 12:15 pm');
  });

  it('preserves a timezone-less business-local database value', () => {
    expect(formatReceiptDate('2026-08-06 12:15:00', 'Australia/Sydney')).toBe('6/8/26, 12:15 pm');
  });

  it('uses the configured business timezone across daylight saving', () => {
    expect(formatReceiptDate('2026-12-06T01:15:00.000Z', 'Australia/Sydney')).toBe('6/12/26, 12:15 pm');
  });

  it('returns invalid values unchanged', () => {
    expect(formatReceiptDate('not-a-date', 'Australia/Sydney')).toBe('not-a-date');
  });
});