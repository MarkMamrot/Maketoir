import { describe, expect, it } from 'vitest';
import { purchaseOrderCurrencyCost } from '../purchaseOrderCurrencyCost';

describe('purchase order currency cost', () => {
  const variant = {
    cost_aud: '1.35',
    cost_foreign: JSON.stringify({ USD: 0.95, eur: 0, GBP: '' }),
  };

  it('uses only the AUD cost for an AUD purchase order', () => {
    expect(purchaseOrderCurrencyCost(variant, 'AUD')).toBe(1.35);
    expect(purchaseOrderCurrencyCost({ cost_foreign: '{"AUD":2}' }, 'AUD')).toBe('');
  });

  it('uses only the matching stored foreign-currency cost', () => {
    expect(purchaseOrderCurrencyCost(variant, 'USD')).toBe(0.95);
    expect(purchaseOrderCurrencyCost(variant, 'eur')).toBe(0);
    expect(purchaseOrderCurrencyCost(variant, 'CAD')).toBe('');
  });

  it('leaves the cost blank when matching data is missing or unusable', () => {
    expect(purchaseOrderCurrencyCost({ cost_aud: null }, 'AUD')).toBe('');
    expect(purchaseOrderCurrencyCost({ cost_aud: 4, cost_foreign: 'invalid' }, 'USD')).toBe('');
    expect(purchaseOrderCurrencyCost(null, 'USD')).toBe('');
  });
});