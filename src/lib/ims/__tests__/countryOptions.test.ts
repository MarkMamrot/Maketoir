import { describe, expect, it } from 'vitest';
import { getCountryOptions } from '../countryOptions';

describe('getCountryOptions', () => {
  it('returns ISO alpha-2 values with localized, sorted labels', () => {
    const options = getCountryOptions('en-AU');

    expect(options).toContainEqual({ id: 'AU', name: 'Australia (AU)' });
    expect(options.every(option => /^[A-Z]{2}$/.test(option.id))).toBe(true);
    expect(options.map(option => option.name)).toEqual(
      [...options.map(option => option.name)].sort((left, right) => left.localeCompare(right, 'en-AU')),
    );
  });

  it('falls back to country codes when display names are unavailable', () => {
    expect(getCountryOptions('en-AU', null)).toContainEqual({ id: 'NZ', name: 'NZ' });
  });
});