import { describe, expect, it } from 'vitest';

import { buildShopifyShipmentQuantities, hasRecordedShopifyFulfilmentQuantities, parseShopifyShipment } from '../shopifyFulfilment';

const orderItems = [
  { id: 10, shopify_line_item_id: '501', qty_ordered: 3, qty_fulfilled: 1 },
  { id: 11, shopify_line_item_id: '502', qty_ordered: 2, qty_fulfilled: 0 },
];

describe('hasRecordedShopifyFulfilmentQuantities', () => {
  const operation = {
    operation_key: 'shopify:store:fulfillments/create:700',
    request_json: { shipmentQuantities: [{ itemId: 10, quantity: 1 }] },
  };
  const verified = (operations: typeof operation[] = [operation]) =>
    hasRecordedShopifyFulfilmentQuantities({ channelInstanceId: 'store', orderItems, operations });

  it('requires exact known quantities for every local line', () => {
    expect(verified()).toBe(true);
    expect(verified([])).toBe(false);
    expect(verified([{ ...operation, request_json: { shipmentQuantities: [{ itemId: 10, quantity: 2 }] } }])).toBe(false);
    expect(verified([{ ...operation, request_json: { shipmentQuantities: [{ itemId: 11, quantity: 1 }] } }])).toBe(false);
  });

  it.each(['shopify:other:fulfillments/create:700', 'shopify:fulfillments/create:700', 'manual:700'])(
    'does not adopt receipt %s', operation_key => {
      expect(verified([{ ...operation, operation_key }])).toBe(false);
    },
  );

  it('combines separate exact-storefront receipts without duplicating a shipment', () => {
    expect(verified([{
      ...operation, request_json: { shipmentQuantities: [{ itemId: 10, quantity: 0.25 }] },
    }, {
      operation_key: 'shopify:store:fulfillments/create:701',
      request_json: { shipmentQuantities: [{ itemId: 10, quantity: 0.75 }] },
    }])).toBe(true);
  });

  it.each([
    '{', null, {}, { shipmentQuantities: null },
    { shipmentQuantities: [{ itemId: 99, quantity: 1 }] },
    { shipmentQuantities: [{ itemId: 10, quantity: -1 }] },
    { shipmentQuantities: [{ itemId: 10, quantity: 0.5 }, { itemId: 10, quantity: 0.5 }] },
  ])('refuses malformed or unowned receipt evidence %j', request_json => {
    expect(hasRecordedShopifyFulfilmentQuantities({
      channelInstanceId: 'store', orderItems, operations: [{ ...operation, request_json }],
    })).toBe(false);
  });

  it('accepts JSON driver output and requires no receipts when nothing has shipped', () => {
    expect(hasRecordedShopifyFulfilmentQuantities({
      channelInstanceId: 'store', orderItems,
      operations: [{ ...operation, request_json: JSON.stringify(operation.request_json) }],
    })).toBe(true);
    expect(hasRecordedShopifyFulfilmentQuantities({
      channelInstanceId: 'store', orderItems: orderItems.map(item => ({ ...item, qty_fulfilled: 0 })), operations: [],
    })).toBe(true);
  });
});

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

describe('parseShopifyShipment', () => {
  it('retains multiple tracking entries and shipment line quantities', () => {
    expect(parseShopifyShipment({
      id: 700,
      status: 'success',
      created_at: '2026-07-01T01:00:00Z',
      line_items: [{ id: 501, quantity: 2 }],
      tracking_company: 'Australia Post',
      tracking_numbers: ['ABC', 'DEF'],
      tracking_urls: ['https://track.example/ABC', 'https://track.example/DEF'],
    })).toMatchObject({
      shopifyFulfilmentId: '700',
      status: 'success',
      items: [{ shopifyLineItemId: '501', quantity: 2 }],
      tracking: [
        { company: 'Australia Post', number: 'ABC', url: 'https://track.example/ABC' },
        { company: 'Australia Post', number: 'DEF', url: 'https://track.example/DEF' },
      ],
    });
  });

  it('deduplicates repeated tracking entries and rejects a missing fulfilment id', () => {
    expect(parseShopifyShipment({
      id: 700,
      tracking_numbers: ['ABC', 'ABC'],
      tracking_urls: ['https://track.example/ABC', 'https://track.example/ABC'],
    })?.tracking).toHaveLength(1);
    expect(parseShopifyShipment({ line_items: [] })).toBeNull();
  });
});