import { describe, expect, it } from 'vitest';
import { normalizeWholesaleLocationIds, normalizeWholesaleLocationName } from '../wholesaleLocations';

describe('wholesale location input', () => {
  it('normalizes names and unique positive location ids', () => {
    expect(normalizeWholesaleLocationName('  Melbourne   CBD ')).toBe('Melbourne CBD');
    expect(normalizeWholesaleLocationIds([61, '60', 61])).toEqual([61, 60]);
  });

  it('requires at least one valid location', () => {
    expect(() => normalizeWholesaleLocationIds([])).toThrow('between 1 and 100');
    expect(() => normalizeWholesaleLocationIds([0])).toThrow('valid buying locations');
  });
});