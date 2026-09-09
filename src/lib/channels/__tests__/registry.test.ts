import { describe, expect, it } from 'vitest';

import { SalesChannelRegistry } from '../registry';
import { isSalesChannelProvider, type SalesChannelAdapter } from '../types';

const shopifyAdapter: SalesChannelAdapter = {
  provider: 'shopify',
  displayName: 'Shopify',
  capabilities: {
    catalogue: true,
    inventory: true,
    orders: true,
    fulfilments: true,
    returns: true,
    customers: true,
    giftCards: true,
    loyalty: true,
    settlements: true,
  },
};

describe('SalesChannelRegistry', () => {
  it('registers and resolves an adapter by provider', () => {
    const registry = new SalesChannelRegistry();

    registry.register(shopifyAdapter);

    expect(registry.get('shopify')).toBe(shopifyAdapter);
    expect(registry.has('shopify')).toBe(true);
    expect(registry.list()).toEqual([shopifyAdapter]);
  });

  it('rejects duplicate provider registrations', () => {
    const registry = new SalesChannelRegistry();
    registry.register(shopifyAdapter);

    expect(() => registry.register({ ...shopifyAdapter })).toThrow(
      'Sales channel adapter already registered for shopify.',
    );
  });

  it('fails clearly when an adapter is unavailable', () => {
    const registry = new SalesChannelRegistry();

    expect(() => registry.get('amazon')).toThrow(
      'Sales channel adapter is not registered for amazon.',
    );
  });
});

describe('isSalesChannelProvider', () => {
  it.each(['shopify', 'native_shop', 'amazon'])('accepts %s', provider => {
    expect(isSalesChannelProvider(provider)).toBe(true);
  });

  it.each(['none', 'woocommerce', '', null])('rejects %s', provider => {
    expect(isSalesChannelProvider(provider)).toBe(false);
  });
});