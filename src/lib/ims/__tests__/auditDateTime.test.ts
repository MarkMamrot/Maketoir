import { describe, expect, it } from 'vitest';
import { formatAuditDateTime } from '../auditDateTime';

describe('formatAuditDateTime', () => {
  it('treats MySQL audit timestamps as UTC and displays them in the business timezone', () => {
    expect(formatAuditDateTime('2026-09-01 00:15:00', 'Australia/Sydney')).toBe('01 Sept 2026, 10:15 am');
  });

  it('preserves an explicit timestamp offset before converting timezone', () => {
    expect(formatAuditDateTime('2026-09-01T00:15:00+08:00', 'Australia/Sydney')).toBe('01 Sept 2026, 02:15 am');
  });

  it('returns invalid input unchanged', () => {
    expect(formatAuditDateTime('not a date', 'Australia/Sydney')).toBe('not a date');
  });
});