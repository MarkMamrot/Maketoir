import { describe, expect, it } from 'vitest';

import { normalizeAmazonOrder } from '../amazonOrderNormalization';

describe('normalizeAmazonOrder', () => {
  it('stores Amazon principal and tax as tax-inclusive line prices', () => {
    const result = normalizeAmazonOrder({
      AmazonOrderId: '111-2222222-3333333', PurchaseDate: '2026-09-15T01:00:00Z',
      LastUpdateDate: '2026-09-15T01:05:00Z', OrderStatus: 'Unshipped', FulfillmentChannel: 'MFN',
      OrderTotal: { CurrencyCode: 'AUD', Amount: '29.70' }, PaymentMethodDetails: ['Standard'],
      ShipmentServiceLevelCategory: 'Standard',
    }, [{
      ASIN: 'B001', OrderItemId: 'item-1', SellerSKU: 'SKU-1', Title: 'Item', QuantityOrdered: 2,
      ItemPrice: { CurrencyCode: 'AUD', Amount: '20.00' }, ItemTax: { CurrencyCode: 'AUD', Amount: '2.00' },
      PromotionDiscount: { CurrencyCode: 'AUD', Amount: '1.00' }, PromotionDiscountTax: { CurrencyCode: 'AUD', Amount: '0.10' },
      ShippingPrice: { CurrencyCode: 'AUD', Amount: '8.00' }, ShippingTax: { CurrencyCode: 'AUD', Amount: '0.80' },
    }]);

    expect(result.lines[0]).toMatchObject({ quantityOrdered: 2, unitPrice: 10.45, lineTotal: 20.9, taxRate: 0.1 });
    expect(result).toMatchObject({ subtotal: 19, taxAmount: 1.9, freight: 8.8, totalAmount: 29.7 });
    expect(result.paymentGateway).toBe('Amazon - Standard');
  });

  it('rejects FBA and non-AUD orders', () => {
    const base = {
      AmazonOrderId: '111-2222222-3333333', PurchaseDate: '2026-09-15T01:00:00Z',
      LastUpdateDate: '2026-09-15T01:05:00Z', OrderStatus: 'Unshipped',
      OrderTotal: { CurrencyCode: 'AUD', Amount: '10.00' },
    };
    const items = [{ ASIN: 'B001', OrderItemId: 'item-1', QuantityOrdered: 1 }];
    expect(() => normalizeAmazonOrder({ ...base, FulfillmentChannel: 'AFN' }, items)).toThrow('seller-fulfilled');
    expect(() => normalizeAmazonOrder({ ...base, FulfillmentChannel: 'MFN', OrderTotal: { CurrencyCode: 'USD', Amount: '10.00' } }, items)).toThrow('not in AUD');
  });
});