import { describe, expect, it } from 'vitest';

import {
  findOnlineGatewayClearingAccount,
  isShopifyPaymentsGateway,
  normalizeOnlineGateway,
  splitOnlineGateways,
} from '../onlineGatewayMappings';

describe('online gateway mappings', () => {
  it('normalizes display names to stable gateway keys', () => {
    expect(normalizeOnlineGateway(' Shopify Payments ')).toBe('shopify_payments');
    expect(normalizeOnlineGateway('PayPal-Express')).toBe('paypal_express');
    expect(normalizeOnlineGateway(null)).toBe('_unknown');
  });

  it('recognizes Shopify Payments inside a multi-gateway value', () => {
    expect(splitOnlineGateways('gift_card, Shopify Payments')).toEqual(['gift_card', 'shopify_payments']);
    expect(isShopifyPaymentsGateway('gift_card, Shopify Payments')).toBe(true);
    expect(isShopifyPaymentsGateway('shopify_payment')).toBe(true);
    expect(isShopifyPaymentsGateway('Shop Pay Installments')).toBe(false);
    expect(isShopifyPaymentsGateway('PayPal Express')).toBe(false);
  });

  it('fuzzy matches configured clearing mappings', () => {
    const mappings = [
      { gateway_name: 'paypal', clearing_account_code: '091' },
      { gateway_name: 'afterpay', clearing_account_code: '092' },
    ];

    expect(findOnlineGatewayClearingAccount('PayPal Express', mappings)).toBe('091');
    expect(findOnlineGatewayClearingAccount('gift_card, Afterpay', mappings)).toBe('092');
    expect(findOnlineGatewayClearingAccount('unknown', mappings)).toBeNull();
  });
});