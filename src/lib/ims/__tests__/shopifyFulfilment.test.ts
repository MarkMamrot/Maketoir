import { describe, expect, it } from 'vitest';

import { buildShopifyShipmentQuantities } from '../shopifyFulfilment';

const orderItems = [
  { id: 10, shopify_line_item_id: '501', qty_ordered: 3, qty_fulfilled: 1 },
  { id: 11, shopify_line_item_id: '502', qty_ordered: 2, qty_fulfilled: 0 },
];

describe('buildShopifyShipmentQuantities', () => {
  it('maps only the lines and quantities in a Shopify fulfillment', () => {
    expect(buildShopifyShipmentQuantities({
      topic: 'fulfillments/create',
      payloadLines: [{ id: 502, quantity: 1 }],
      orderItems,
    })).toEqual([{ itemId: 11, quantity: 1 }]);
  });

  it('combines duplicate payload entries for the same Shopify line', () => {
    expect(buildShopifyShipmentQuantities({
      topic: 'fulfillments/create',
      payloadLines: [{ id: 501, quantity: 1 }, { id: 501, quantity: 1 }],
      orderItems,
    })).toEqual([{ itemId: 10, quantity: 2 }]);
  });

  it('uses all outstanding quantities for the orders/fulfilled fallback topic', () => {
    expect(buildShopifyShipmentQuantities({
      topic: 'orders/fulfilled',
      payloadLines: [],
      orderItems,
    })).toEqual([{ itemId: 10, quantity: 2 }, { itemId: 11, quantity: 2 }]);
  });

  it('rejects a Shopify line that is not mapped to the IMS order', () => {
    expect(() => buildShopifyShipmentQuantities({
      topic: 'fulfillments/create',
      payloadLines: [{ id: 999, quantity: 1 }],
      orderItems,
    })).toThrow('is not mapped to this sales order');
  });
});