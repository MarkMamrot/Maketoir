import { describe, expect, it } from 'vitest';

import { isLeadTemperature, resolveLeadTemperature } from '../leadQualification';

describe('lead qualification', () => {
  it('defaults manually created leads to warm', () => {
    expect(resolveLeadTemperature('lead', undefined)).toBe('warm');
  });

  it('accepts an explicit discovered-lead temperature', () => {
    expect(resolveLeadTemperature('lead', 'cold')).toBe('cold');
    expect(isLeadTemperature('hot')).toBe(true);
  });

  it('clears qualification for non-lead contacts', () => {
    expect(resolveLeadTemperature('b2b_customer', 'hot')).toBeNull();
  });

  it('rejects unsupported lead temperatures', () => {
    expect(() => resolveLeadTemperature('lead', 'qualified')).toThrow('cold, warm, or hot');
  });
});