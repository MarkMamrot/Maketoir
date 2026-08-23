import { describe, expect, it } from 'vitest';

import { getLeadCapabilities, validateDateParameter } from '../helpers';

describe('prospect lead route helpers', () => {
  it('reports only schema-backed optional capabilities', () => {
    expect(getLeadCapabilities(['id', 'status', 'assigned_to', 'notes'])).toEqual({
      assignment: true, notes: true, lossReason: false,
    });
  });

  it('validates real ISO calendar dates', () => {
    expect(validateDateParameter('2026-08-23', 'from')).toBeNull();
    expect(validateDateParameter('2026-02-30', 'from')).toBe('from must be a valid date.');
    expect(validateDateParameter('23/08/2026', 'from')).toBe('from must use YYYY-MM-DD.');
  });
});