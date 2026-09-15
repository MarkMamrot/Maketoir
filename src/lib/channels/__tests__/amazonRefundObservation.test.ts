import { describe, expect, it } from 'vitest';

import { amazonRefundEventId, normalizeAmazonRefundTransactions } from '../amazonRefundObservation';

describe('Amazon refund observations', () => {
  it('normalizes only released transactions with order and refund identities', () => {
    const observations = normalizeAmazonRefundTransactions([{
      transactionId: 'transaction-1', transactionStatus: 'RELEASED', postedDate: '2026-09-15T01:02:03Z',
      relatedIdentifiers: [
        { relatedIdentifierName: 'ORDER_ID', relatedIdentifierValue: '111-2222222-3333333' },
        { relatedIdentifierName: 'REFUND_ID', relatedIdentifierValue: 'refund-1' },
      ],
      totalAmount: { currencyCode: 'AUD', currencyAmount: -8.37 },
      items: [{ contexts: [{ contextType: 'Product', sku: 'SKU-1', asin: 'B001', quantityShipped: -2 }] }],
    }, {
      transactionId: 'transaction-2', transactionStatus: 'DEFERRED', postedDate: '2026-09-15T01:02:03Z',
      relatedIdentifiers: [{ relatedIdentifierName: 'REFUND_ID', relatedIdentifierValue: 'refund-2' }],
    }]);
    expect(observations).toEqual([expect.objectContaining({
      amazonOrderId: '111-2222222-3333333', amazonRefundId: 'refund-1', transactionId: 'transaction-1',
      sellerNetAmount: -8.37, currencyCode: 'AUD',
      items: [{ merchantSku: 'SKU-1', asin: 'B001', quantity: 2 }],
    })]);
    expect(amazonRefundEventId(observations[0])).toBe('refund:refund-1:transaction-1');
  });
});