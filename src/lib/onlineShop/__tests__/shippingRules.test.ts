import { describe, expect, it } from 'vitest';

import { normalizeAustralianShippingAddress, quoteOnlineShopShipping, type OnlineShopShippingRule } from '../shippingRules';

const address = normalizeAustralianShippingAddress({ address: '1 George St', suburb: 'Sydney', state: 'nsw', postcode: '2000', country: 'AU' });
const rules: OnlineShopShippingRule[] = [
  { id: 2, name: 'Metro', ruleType: 'flat', amountCents: 800, freeOverCents: 10000, states: ['NSW'], postcodes: ['2000-2234'], sortOrder: 2 },
  { id: 1, name: 'Australia', ruleType: 'flat', amountCents: 1200, freeOverCents: null, states: [], postcodes: [], sortOrder: 5 },
];

describe('native online shop shipping rules', () => {
  it('normalizes an Australian address', () => {
    expect(address).toMatchObject({ state: 'NSW', postcode: '2000', country: 'Australia' });
  });

  it('returns matching rules in merchant order', () => {
    expect(quoteOnlineShopShipping({ address, subtotalCents: 5000, rules })).toEqual([
      { ruleId: 2, label: 'Metro', amountCents: 800 },
      { ruleId: 1, label: 'Australia', amountCents: 1200 },
    ]);
  });

  it('applies free shipping thresholds in integer cents', () => {
    expect(quoteOnlineShopShipping({ address, subtotalCents: 10000, rules })[0].amountCents).toBe(0);
  });

  it('supports postcode prefixes and rejects incomplete addresses', () => {
    const prefixRule = [{ ...rules[0], postcodes: ['2*'] }];
    expect(quoteOnlineShopShipping({ address, subtotalCents: 1, rules: prefixRule })).toHaveLength(1);
    expect(() => normalizeAustralianShippingAddress({ state: 'NSW', postcode: '2000' })).toThrow('complete Australian');
  });
});