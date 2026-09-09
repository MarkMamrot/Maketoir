import { SalesChannelRegistry } from './registry';

export function createDefaultSalesChannelRegistry(): SalesChannelRegistry {
  const registry = new SalesChannelRegistry();
  registry.register({
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
  });
  registry.register({
    provider: 'native_shop',
    displayName: 'Solvantis Online Store',
    capabilities: {
      catalogue: true,
      inventory: true,
      orders: true,
      fulfilments: true,
      returns: true,
      customers: true,
      giftCards: false,
      loyalty: true,
      settlements: false,
    },
  });
  return registry;
}
