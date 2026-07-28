import { describe, expect, it } from 'vitest';

import {
  classifyShopifyPayoutTransaction,
  reconcileShopifyPayout,
} from '../shopifyPayoutReconciliation';

describe('reconcileShopifyPayout', () => {
  it('allocates a Monday payout across the actual weekend and Monday invoices', () => {
    const result = reconcileShopifyPayout({
      payoutAmount: 297,
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'sat', type: 'charge', amount: 100, fee: -2, net: 98, currency: 'AUD', invoiceId: 'inv-sat', invoiceDate: '2026-07-25' },
        { id: 'sun', type: 'charge', amount: 80, fee: -1.6, net: 78.4, currency: 'AUD', invoiceId: 'inv-sun', invoiceDate: '2026-07-26' },
        { id: 'mon', type: 'charge', amount: 123, fee: -2.4, net: 120.6, currency: 'AUD', invoiceId: 'inv-mon', invoiceDate: '2026-07-27' },
      ],
    });

    expect(result).toMatchObject({
      balanced: true,
      transactionNet: 297,
      grossCharges: 303,
      fees: 6,
      difference: 0,
      unresolvedChargeIds: [],
    });
    expect(result.invoiceAllocations.map(allocation => [allocation.invoiceDate, allocation.amount])).toEqual([
      ['2026-07-25', 100],
      ['2026-07-26', 80],
      ['2026-07-27', 123],
    ]);
  });

  it('ignores the negative payout settlement marker returned by Shopify', () => {
    const result = reconcileShopifyPayout({
      payoutAmount: 855.09,
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'charge-1', type: 'charge', amount: 886.81, fee: -18.77, net: 868.04, currency: 'AUD', invoiceId: 'inv-23', invoiceDate: '2026-07-23' },
        { id: 'refund-1', type: 'refund', amount: -12.95, fee: 0, net: -12.95, currency: 'AUD' },
        { id: 'payout-1', type: 'payout', amount: -855.09, fee: 0, net: -855.09, currency: 'AUD' },
      ],
    });

    expect(result).toMatchObject({
      balanced: true,
      transactionNet: 855.09,
      difference: 0,
      grossCharges: 886.81,
      refunds: 12.95,
      fees: 18.77,
      adjustments: 0,
    });
  });

  it('aggregates multiple charges for the same daily invoice', () => {
    const result = reconcileShopifyPayout({
      payoutAmount: 68.5,
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'charge-1', type: 'charge', amount: 50, fee: -1, net: 49, currency: 'AUD', invoiceId: 'inv-1', invoiceDate: '2026-07-25' },
        { id: 'charge-2', type: 'payment', amount: 20, fee: -0.5, net: 19.5, currency: 'AUD', invoiceId: 'inv-1', invoiceDate: '2026-07-25' },
      ],
    });

    expect(result.invoiceAllocations).toEqual([{
      invoiceId: 'inv-1',
      invoiceDate: '2026-07-25',
      amount: 70,
      transactionIds: ['charge-1', 'charge-2'],
    }]);
  });

  it('blocks reconciliation when a charge has no daily invoice', () => {
    const result = reconcileShopifyPayout({
      payoutAmount: 49,
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'charge-1', type: 'charge', amount: 50, fee: -1, net: 49, currency: 'AUD' },
      ],
    });

    expect(result.balanced).toBe(false);
    expect(result.difference).toBe(0);
    expect(result.unresolvedChargeIds).toEqual(['charge-1']);
  });

  it('reports payout differences using cent-safe arithmetic', () => {
    const result = reconcileShopifyPayout({
      payoutAmount: '9.99',
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'charge-1', type: 'charge', amount: '10.00', fee: '-0.01', net: '9.98', currency: 'AUD', invoiceId: 'inv-1', invoiceDate: '2026-07-25' },
      ],
    });

    expect(result.balanced).toBe(false);
    expect(result.difference).toBe(-0.01);
  });

  it('rejects mixed-currency payouts', () => {
    expect(() => reconcileShopifyPayout({
      payoutAmount: 10,
      payoutCurrency: 'AUD',
      transactions: [
        { id: 'charge-1', type: 'charge', amount: 10, fee: 0, net: 10, currency: 'NZD', invoiceId: 'inv-1', invoiceDate: '2026-07-25' },
      ],
    })).toThrow('does not match');
  });
});

describe('classifyShopifyPayoutTransaction', () => {
  it('treats non-charge and non-refund types as signed adjustments', () => {
    expect(classifyShopifyPayoutTransaction('charge')).toBe('charge');
    expect(classifyShopifyPayoutTransaction('refund')).toBe('refund');
    expect(classifyShopifyPayoutTransaction('payout')).toBe('settlement');
    expect(classifyShopifyPayoutTransaction('reserve')).toBe('adjustment');
    expect(classifyShopifyPayoutTransaction('dispute')).toBe('adjustment');
  });
});