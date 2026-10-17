import { describe, expect, it } from 'vitest';
import { shopifyOrderSnapshot, validateShopifyOrderIdentity } from '../shopifyOrderSnapshot';

const owner = { businessId: 'alpha', channelInstanceId: 'store' };
const order = {
  id: 123, updated_at: '2026-10-17T01:00:00Z', created_at: '2026-10-01T01:00:00Z',
  financial_status: 'paid', fulfillment_status: null, cancelled_at: null, currency: 'AUD',
  subtotal_price: '10.00', total_tax: '1.00', total_price: '11.00', total_discounts: '0.00',
  line_items: [{ id: 41, variant_id: 51, quantity: 1, price: '10.00', sku: 'BLUE-001' }],
  refunds: [], fulfillments: [], customer: { id: 61, email: 'private@example.test' },
};
const snapshot = (value: Record<string, unknown>) => shopifyOrderSnapshot({ ...owner, order: value });

describe('full Shopify snapshot identity and fingerprint', () => {
  it('produces only exact owner, normalized version and a hash, not a stored customer payload', () => {
    const result = snapshot(order);
    expect(result).toEqual({ ...owner, externalOrderId: '123', updatedAt: '2026-10-17T01:00:00.000Z',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(result)).not.toContain('BLUE-001');
  });
  it('ignores dictionary key ordering, unrelated marketing fields and unused customer details', () => {
    const reordered = Object.fromEntries(Object.entries(order).reverse());
    expect(snapshot({ ...reordered, tags: 'new-tag', customer: { id: 61, email: 'changed@example.test' } }).hash)
      .toBe(snapshot(order).hash);
  });
  it('normalizes equivalent root amounts and timestamp offsets', () => {
    expect(snapshot({ ...order, subtotal_price: 10, total_price: '11.0', updated_at: '2026-10-17T12:00:00+11:00' }).hash)
      .toBe(snapshot(order).hash);
  });
  it('keeps the functional fingerprint stable on a newer provider version with no relevant changes', () => {
    expect(snapshot({ ...order, updated_at: '2026-10-17T01:01:00Z' }).hash).toBe(snapshot(order).hash);
  });
  it('captures the loyalty paid-date fallback instead of ignoring its effective input', () => {
    expect(snapshot({ ...order, updated_at: '2026-10-18T01:01:00Z' }).hash).not.toBe(snapshot(order).hash);
    const processed = { ...order, processed_at: order.created_at };
    expect(snapshot({ ...processed, updated_at: '2026-10-18T01:01:00Z' }).hash).toBe(snapshot(processed).hash);
  });
  it.each([
    { total_price: '12.00' },
    { financial_status: 'refunded' },
    { cancelled_at: '2026-10-17T01:00:00Z' },
    { line_items: [{ ...order.line_items[0], quantity: 2 }] },
    { line_items: [{ ...order.line_items[0], current_quantity: 0 }] },
    { line_items: [{ ...order.line_items[0], discount_allocations: [{ amount: '1.00' }] }] },
    { refunds: [{ id: 71, transactions: [{ kind: 'refund', amount: '11.00' }] }] },
    { fulfillments: [{ id: 81, line_items: [{ id: 41, quantity: 1 }], tracking_number: 'TRACK' }] },
    { shipping_address: { address1: 'Changed address', city: 'Sydney' } },
    { shipping_lines: [{ title: 'Store pickup' }] },
    { payment_gateway_names: ['gift_card'] },
    { customer: { id: 62 } },
  ])('captures a relevant lifecycle or financial change: %j', changes => {
    expect(snapshot({ ...order, ...changes }).hash).not.toBe(snapshot(order).hash);
  });
  it('scopes the fingerprint to exact business and storefront', () => {
    expect(shopifyOrderSnapshot({ ...owner, businessId: 'other', order }).hash).not.toBe(snapshot(order).hash);
    expect(shopifyOrderSnapshot({ ...owner, channelInstanceId: 'other', order }).hash).not.toBe(snapshot(order).hash);
  });
  it.each(['line_items', 'refunds', 'fulfillments', 'cancelled_at', 'financial_status', 'currency'])(
    'rejects partial payloads missing %s', key => {
      const partial: Record<string, unknown> = { ...order };
      delete partial[key];
      expect(() => snapshot(partial)).toThrow();
    },
  );
  it.each(['', '-1', 'NaN', Number.NaN, null])('rejects an invalid order amount %s', total_price => {
    expect(() => snapshot({ ...order, total_price })).toThrow('snapshot amount');
  });
  it('rejects duplicate entity IDs rather than hashing ambiguous source data', () => {
    expect(() => snapshot({ ...order, line_items: [order.line_items[0], order.line_items[0]] }))
      .toThrow('Duplicate Shopify snapshot entity');
  });
  it('rejects unsafe numeric IDs and missing or unzoned update versions', () => {
    expect(() => snapshot({ ...order, id: Number.MAX_SAFE_INTEGER + 1 })).toThrow('snapshot identity');
    expect(() => snapshot({ ...order, updated_at: '2026-10-17T01:00:00' })).toThrow('explicit timezone');
    expect(() => snapshot({ id: 123 })).toThrow('complete Shopify order snapshot');
  });
  it.each([
    { ...owner, businessId: '', externalOrderId: '123' },
    { ...owner, channelInstanceId: ' ', externalOrderId: '123' },
    { ...owner, externalOrderId: '0' },
    { ...owner, externalOrderId: 'https://example.test' },
  ])('rejects an invalid owner: %j', identity => {
    expect(() => validateShopifyOrderIdentity(identity)).toThrow('exact Shopify order owner');
  });
});
