import { describe, expect, it } from 'vitest';

import {
  isWholesaleBrandAllowed,
  isWholesaleContactEligible,
  isWholesaleEnabled,
  normalizeWholesaleBrands,
  parseWholesaleBrandAccess,
} from '../wholesaleAccess';

describe('wholesale access', () => {
  it('defaults a missing business setting to enabled', () => {
    expect(isWholesaleEnabled(undefined)).toBe(true);
    expect(isWholesaleEnabled('yes')).toBe(true);
    expect(isWholesaleEnabled('no')).toBe(false);
  });

  it('distinguishes unrestricted, none, and selected brands', () => {
    expect(parseWholesaleBrandAccess(null)).toEqual({ mode: 'all', brands: [] });
    expect(parseWholesaleBrandAccess('[]')).toEqual({ mode: 'none', brands: [] });
    expect(parseWholesaleBrandAccess('["Acme"]')).toEqual({ mode: 'selected', brands: ['Acme'] });
  });

  it('trims and de-duplicates brand names case-insensitively', () => {
    expect(normalizeWholesaleBrands([' Acme ', 'ACME', '', 'Beta'])).toEqual(['Acme', 'Beta']);
  });

  it('rejects malformed or non-string brand lists', () => {
    expect(() => normalizeWholesaleBrands('{"brand":"Acme"}')).toThrow('must be an array');
    expect(() => normalizeWholesaleBrands('["Acme", 12]')).toThrow('must be brand names');
    expect(() => normalizeWholesaleBrands('not-json')).toThrow('valid JSON array');
  });

  it('matches selected brands without allowing unbranded products', () => {
    const access = parseWholesaleBrandAccess(['Acme']);
    expect(isWholesaleBrandAllowed(access, 'ACME')).toBe(true);
    expect(isWholesaleBrandAllowed(access, 'Beta')).toBe(false);
    expect(isWholesaleBrandAllowed(access, null)).toBe(false);
  });

  it('allows unbranded products only in unrestricted mode', () => {
    expect(isWholesaleBrandAllowed(parseWholesaleBrandAccess(null), null)).toBe(true);
    expect(isWholesaleBrandAllowed(parseWholesaleBrandAccess([]), 'Acme')).toBe(false);
  });

  it('requires an active wholesale-tier B2B or Both contact', () => {
    expect(isWholesaleContactEligible('b2b_customer', 'wholesale', 1)).toBe(true);
    expect(isWholesaleContactEligible('both', 'WHOLESALE', true)).toBe(true);
    expect(isWholesaleContactEligible('retail_customer', 'wholesale', 1)).toBe(false);
    expect(isWholesaleContactEligible('b2b_customer', 'retail', 1)).toBe(false);
    expect(isWholesaleContactEligible('b2b_customer', 'wholesale', 0)).toBe(false);
  });
});