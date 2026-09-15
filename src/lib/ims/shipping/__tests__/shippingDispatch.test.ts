import { describe, expect, it } from 'vitest';

import { buildAmazonShipmentConfirmations, buildOutboundTracking, buildShopifyFulfilmentGroups, findMatchingShopifyFulfilmentId, formatShopifyFulfilmentError, shopifyNumericId } from '../shippingDispatch';

describe('shipping dispatch Shopify mapping', () => {
  it('maps dispatched quantities to fulfillment-order lines', () => {
    expect(buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 2, lineItem: { id: 'gid://shopify/LineItem/101' } }] } }],
    )).toEqual([{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1', fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', quantity: 2 }] }]);
  });

  it('treats zero remaining quantity as an already-completed retry', () => {
    expect(buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 0, lineItem: { id: 'gid://shopify/LineItem/101' } }] } }],
    )).toEqual([]);
  });

  it('matches an existing Shopify fulfillment before updating its carrier tracking', () => {
    expect(findMatchingShopifyFulfilmentId(
      [{ shopify_line_item_id: '101', quantity: 2 }, { shopify_line_item_id: '102', quantity: 1 }],
      [
        { shopify_fulfilment_id: 'fulfillment-2', shopify_line_item_id: '101', quantity: 2 },
        { shopify_fulfilment_id: 'fulfillment-1', shopify_line_item_id: '101', quantity: 2 },
        { shopify_fulfilment_id: 'fulfillment-1', shopify_line_item_id: '102', quantity: 1 },
      ],
    )).toBe('fulfillment-1');
  });

  it('does not attach tracking to an unrelated existing Shopify fulfillment', () => {
    expect(findMatchingShopifyFulfilmentId(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ shopify_fulfilment_id: 'fulfillment-1', shopify_line_item_id: '101', quantity: 1 }],
    )).toBeNull();
  });

  it('rejects a partial remainder and preserves Shopify error details', () => {
    expect(() => buildShopifyFulfilmentGroups(
      [{ shopify_line_item_id: '101', quantity: 2 }],
      [{ id: 'gid://shopify/FulfillmentOrder/1', lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 1, lineItem: { id: 'gid://shopify/LineItem/101' } }] } }],
    )).toThrow('enough fulfillable quantity');
    expect(formatShopifyFulfilmentError(403, { errors: [{ message: 'Access denied' }] })).toContain('Access denied');
  });

  it('explains how to repair missing Shopify fulfillment-order permissions', () => {
    expect(formatShopifyFulfilmentError(200, {
      errors: [{ message: "Access denied for fulfillmentOrders field." }],
    })).toContain('write_merchant_managed_fulfillment_orders');
  });

  it('extracts the numeric Shopify line item ID from a GraphQL GID', () => {
    expect(shopifyNumericId('gid://shopify/LineItem/16816143302872')).toBe('16816143302872');
    expect(shopifyNumericId('16816143302872')).toBe('16816143302872');
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

describe('shipping dispatch Amazon mapping', () => {
  it('builds one stable confirmation per tracked parcel and combines matching item rows', () => {
    expect(buildAmazonShipmentConfirmations([
      { parcelId: '41', provider: 'auspost_eparcel', carrierName: 'eParcel', serviceName: 'Parcel Post',
        articleId: 'AP-1', consignmentId: 'CON-1', externalOrderItemId: 'item-1', quantity: 1 },
      { parcelId: '41', provider: 'auspost_eparcel', carrierName: 'eParcel', serviceName: 'Parcel Post',
        articleId: 'AP-1', consignmentId: 'CON-1', externalOrderItemId: 'item-1', quantity: 2 },
      { parcelId: '42', provider: 'custom_carrier', carrierName: 'Local Courier', serviceName: null,
        articleId: null, consignmentId: 'LOCAL-2', externalOrderItemId: 'item-2', quantity: 1 },
    ], '2026-09-15T01:02:03.000Z')).toEqual([
      { parcelId: '41', confirmation: {
        packageReferenceId: '41', carrierCode: 'Australia Post', carrierName: 'Australia Post',
        shippingMethod: 'Parcel Post', trackingNumber: 'AP-1', shipDate: '2026-09-15T01:02:03.000Z',
        orderItems: [{ orderItemId: 'item-1', quantity: 3 }],
      } },
      { parcelId: '42', confirmation: {
        packageReferenceId: '42', carrierCode: 'Other', carrierName: 'Local Courier',
        trackingNumber: 'LOCAL-2', shipDate: '2026-09-15T01:02:03.000Z',
        orderItems: [{ orderItemId: 'item-2', quantity: 1 }],
      } },
    ]);
  });

  it('rejects missing Amazon item identity and fractional dispatched quantities', () => {
    const base = { parcelId: '41', provider: 'auspost_eparcel', carrierName: 'eParcel', serviceName: 'Parcel Post',
      articleId: 'AP-1', consignmentId: null, externalOrderItemId: 'item-1', quantity: 1 };
    expect(() => buildAmazonShipmentConfirmations([{ ...base, externalOrderItemId: null }], '2026-09-15T01:02:03Z'))
      .toThrow('not mapped');
    expect(() => buildAmazonShipmentConfirmations([{ ...base, quantity: 1.5 }], '2026-09-15T01:02:03Z'))
      .toThrow('positive integer');
  });
});