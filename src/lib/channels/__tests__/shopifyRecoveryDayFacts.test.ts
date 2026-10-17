import { describe, expect, it } from 'vitest';
import { shopifyAccountingFactsHash } from '../shopifyRecoveryDayFacts';
const order = {
  business_date: '2026-10-17', status: 'confirmed', subtotal: '20.00', tax_amount: '2.00', total_amount: '22.00',
  currency_code: 'AUD', payment_gateway: 'card',
};
const lines = [{ external_order_item_id: '1', variant_id: 'variant', qty_ordered: '2.0000', unit_price: '11.00' }];
describe('online financial dirty-day evidence', () => {
  it('ignores stock, tracking, fulfilment and refund financial-status changes', () => {
    expect(shopifyAccountingFactsHash({ ...order, status: 'fulfilled', financial_status: 'refunded', refunded_amount: 22 }, lines))
      .toBe(shopifyAccountingFactsHash(order, lines));
  });
  it('normalizes equivalent MySQL decimal representations', () => {
    expect(shopifyAccountingFactsHash({ ...order, total_amount: 22 }, [{ ...lines[0], unit_price: 11 }]))
      .toBe(shopifyAccountingFactsHash(order, lines));
  });
  it.each([{ status: 'cancelled' }, { total_amount: 23 }, { payment_gateway: 'paypal' }])(
    'detects invoice-relevant root changes %#', change => {
      expect(shopifyAccountingFactsHash({ ...order, ...change }, lines)).not.toBe(shopifyAccountingFactsHash(order, lines));
    },
  );
  it('detects original line quantity changes but not internal line-ID replacement', () => {
    const original = shopifyAccountingFactsHash(order, lines);
    expect(shopifyAccountingFactsHash(order, [{ ...lines[0], id: 99 }])).toBe(original);
    expect(shopifyAccountingFactsHash(order, [{ ...lines[0], qty_ordered: 1 }])).not.toBe(original);
  });
});
