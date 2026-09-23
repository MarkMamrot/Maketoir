import { describe, expect, it } from 'vitest';
import {
  addAuditDays,
  compareAuditFindingsNewestFirst,
  fingerprintAuditEvidence,
  isAuditOverdue,
  previousCalendarMonth,
  resolveAuditDueDate,
  type AuditFinding,
} from '../domain';

function finding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    key: 'sales_order:1:overdue',
    fingerprint: 'fingerprint',
    category: 'orders_returns',
    severity: 'warning',
    coverage: 'checked',
    title: 'Sales order overdue',
    summary: 'SO-1 requires attention.',
    sourceType: 'sales_order',
    sourceId: '1',
    sourceReference: 'SO-1',
    sourceHref: null,
    occurredAt: '2026-09-01T00:00:00.000Z',
    detectedAt: '2026-09-23T00:00:00.000Z',
    dueDate: null,
    expected: null,
    actual: null,
    variance: null,
    valueAtRisk: null,
    recommendedAction: 'Review the order.',
    ...overrides,
  };
}

describe('bookkeeper audit due dates', () => {
  it('uses an explicit date without applying a fallback', () => {
    expect(resolveAuditDueDate({
      explicitDate: '2026-10-03',
      fallbackDate: '2026-09-01',
      rule: 'sales_order_active',
    })).toEqual({ date: '2026-10-03', source: 'explicit', assumedDays: null });
  });

  it.each([
    ['purchase_order_active', '2026-10-01', 30],
    ['sales_order_active', '2026-09-15', 14],
    ['customer_credit_note_awaiting_product', '2026-10-01', 30],
    ['branch_transfer_active', '2026-09-08', 7],
    ['stocktake_in_progress', '2026-09-03', 2],
  ] as const)('applies the %s fallback', (rule, date, assumedDays) => {
    expect(resolveAuditDueDate({ fallbackDate: '2026-09-01', rule })).toEqual({
      date,
      source: 'assumed',
      assumedDays,
    });
  });

  it('handles month ends and leap years in UTC', () => {
    expect(addAuditDays('2028-02-28', 2)).toBe('2028-03-01');
    expect(addAuditDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('treats a due date as overdue only after that date', () => {
    const dueDate = resolveAuditDueDate({ fallbackDate: '2026-09-01', rule: 'branch_transfer_active' });
    expect(isAuditOverdue(dueDate, '2026-09-08')).toBe(false);
    expect(isAuditOverdue(dueDate, '2026-09-09')).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(() => addAuditDays('2026-02-30', 1)).toThrow('Invalid audit date');
  });

  it('returns the previous completed calendar month across year and leap-year boundaries', () => {
    expect(previousCalendarMonth('2026-01-15')).toEqual({
      startDate: '2025-12-01', endDateExclusive: '2026-01-01', periodEnd: '2025-12-31',
    });
    expect(previousCalendarMonth('2028-03-10')).toEqual({
      startDate: '2028-02-01', endDateExclusive: '2028-03-01', periodEnd: '2028-02-29',
    });
  });
});

describe('compareAuditFindingsNewestFirst', () => {
  it('sorts by occurrence, detection, then stable key', () => {
    const findings = [
      finding({ key: 'b', occurredAt: '2026-09-02T00:00:00.000Z', detectedAt: '2026-09-03T00:00:00.000Z' }),
      finding({ key: 'c', occurredAt: '2026-09-03T00:00:00.000Z', detectedAt: '2026-09-03T00:00:00.000Z' }),
      finding({ key: 'a', occurredAt: '2026-09-02T00:00:00.000Z', detectedAt: '2026-09-04T00:00:00.000Z' }),
    ];

    expect(findings.sort(compareAuditFindingsNewestFirst).map(item => item.key)).toEqual(['c', 'a', 'b']);
  });
});

describe('fingerprintAuditEvidence', () => {
  it('is stable across object key order and changes with evidence', () => {
    expect(fingerprintAuditEvidence({ actual: 12, expected: { amount: 10, currency: 'AUD' } }))
      .toBe(fingerprintAuditEvidence({ expected: { currency: 'AUD', amount: 10 }, actual: 12 }));
    expect(fingerprintAuditEvidence({ actual: 12 })).not.toBe(fingerprintAuditEvidence({ actual: 13 }));
  });
});