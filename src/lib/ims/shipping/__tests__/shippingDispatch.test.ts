import { describe, expect, it } from 'vitest';

import { buildShopifyFulfilmentGroups, formatShopifyFulfilmentError } from '../shippingDispatch';

describe('shipping dispatch Shopify mapping', () => {
  it('maps dispatched quantities to fulfillment-order lines', () => {
    expect(buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 2, lineItem: { legacyResourceId: '101' } }] } }],
    )).toEqual([{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1', fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', quantity: 2 }] }]);
  });

  it('treats zero remaining quantity as an already-completed retry', () => {
    expect(buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 0, lineItem: { legacyResourceId: '101' } }] } }],
    )).toEqual([]);
  });

  it('rejects a partial remainder and preserves Shopify error details', () => {
    expect(() => buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 1, lineItem: { legacyResourceId: '101' } }] } }],
    )).toThrow('enough fulfillable quantity');
    expect(formatShopifyFulfilmentError(403, { errors: [{ message: 'Access denied' }] })).toContain('Access denied');
  });
});