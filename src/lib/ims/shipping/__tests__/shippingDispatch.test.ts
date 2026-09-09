import { describe, expect, it } from 'vitest';

import { buildOutboundTracking, buildShopifyFulfilmentGroups, formatShopifyFulfilmentError } from '../shippingDispatch';

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

  it('builds unique carrier tracking numbers and URLs for the original channel', () => {
    expect(buildOutboundTracking([
      { provider: 'auspost_eparcel', article_id: 'AP-ARTICLE-1', consignment_id: 'AP-CONSIGNMENT', tracking_url: null },
      { provider: 'auspost_eparcel', article_id: 'AP-ARTICLE-2', consignment_id: 'AP-CONSIGNMENT', tracking_url: 'https://tracking.example/2' },
      { provider: 'auspost_eparcel', article_id: 'AP-ARTICLE-1', consignment_id: 'AP-CONSIGNMENT', tracking_url: null },
    ])).toEqual({
      company: 'Australia Post',
      numbers: ['AP-ARTICLE-1', 'AP-ARTICLE-2'],
      urls: [
        'https://auspost.com.au/mypost/track/#/details/AP-ARTICLE-1',
        'https://tracking.example/2',
      ],
    });
  });

  it('falls back to the carrier consignment number when an article number is unavailable', () => {
    expect(buildOutboundTracking([
      { provider: 'auspost_eparcel', article_id: null, consignment_id: 'AP-CONSIGNMENT', tracking_url: null },
    ])).toEqual({
      company: 'Australia Post',
      numbers: ['AP-CONSIGNMENT'],
      urls: ['https://auspost.com.au/mypost/track/#/details/AP-CONSIGNMENT'],
    });
  });
});