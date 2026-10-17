import { describe, expect, it } from 'vitest';
import { planShopifyOrderRecovery } from '../shopifyOrderRecoveryPlan';

const order: Record<string, unknown> = {
  id: '123', created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T01:00:00Z',
  financial_status: 'paid', currency: 'AUD', cancelled_at: null, fulfillment_status: null,
  subtotal_price: '20', total_tax: '2', total_price: '22', total_discounts: '0',
  line_items: [{ id: '456', quantity: 2, price: '11' }], fulfillments: [], refunds: [],
};
const plan = (payload = order) => planShopifyOrderRecovery({ businessId: 'alpha', channelInstanceId: 'store', order: payload });

describe('full-source Shopify recovery effect plans', () => {
  it('requires the order record before durable downstream handoff', () => {
    expect(plan().keys).toEqual(['order_record', 'downstream']);
    expect(plan().paid).toBe(true);
  });
  it('keeps partial fulfilments distinct and excludes failed shipments from stock', () => {
    const result = plan({ ...order, fulfillments: [
      { id: '7001', status: 'success' }, { id: '7002', status: 'failure' },
    ] });
    expect(result.keys).toEqual(['order_record', 'fulfilment:7001', 'downstream']);
    expect(result.keys).not.toContain('order_fulfilment');
  });
  it('does not accept partial event payloads as a full source version', () => {
    expect(() => plan({ id: '123' })).toThrow();
  });
  it.each(['refunded', 'partially_refunded'])('retains paid recovery for %s orders', financial_status => {
    expect(plan({ ...order, financial_status }).paid).toBe(true);
  });
  it('does not invent payment for a voided order', () => {
    expect(plan({ ...order, financial_status: 'voided' }).paid).toBe(false);
  });
});
