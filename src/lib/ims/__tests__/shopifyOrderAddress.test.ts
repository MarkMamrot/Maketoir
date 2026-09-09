import { describe, expect, it } from 'vitest';
import { parseShopifyOrderDeliveryAddress, parseShopifyOrderDeliveryMethod } from '../shopifyOrderAddress';

describe('parseShopifyOrderDeliveryAddress', () => {
  it('maps the Shopify shipping address to IMS delivery fields', () => {
    expect(parseShopifyOrderDeliveryAddress({
      shipping_address: {
        address1: ' 12 Market Street ',
        address2: ' Rear loading dock ',
        city: 'Newcastle',
        province: 'New South Wales',
        province_code: 'NSW',
        zip: '2300',
        country: 'Australia',
        country_code: 'AU',
      },
    })).toEqual({
      delivery_address: '12 Market Street',
      delivery_address2: 'Rear loading dock',
      delivery_suburb: 'Newcastle',
      delivery_city: 'Newcastle',
      delivery_state: 'NSW',
      delivery_postcode: '2300',
      delivery_country: 'AU',
    });
  });

  it('uses full state and country names when Shopify codes are absent', () => {
    const result = parseShopifyOrderDeliveryAddress({
      shipping_address: { address1: '1 High Street', city: 'Fitzroy', province: 'Victoria', country: 'Australia' },
    });

    expect(result.delivery_state).toBe('Victoria');
    expect(result.delivery_country).toBe('Australia');
  });

  it('returns null delivery fields when an order has no shipping address', () => {
    expect(parseShopifyOrderDeliveryAddress({ billing_address: { address1: 'Billing only' } })).toEqual({
      delivery_address: null,
      delivery_address2: null,
      delivery_suburb: null,
      delivery_city: null,
      delivery_state: null,
      delivery_postcode: null,
      delivery_country: null,
    });
  });

  it('preserves the Shopify method and identifies addressless pickup orders', () => {
    expect(parseShopifyOrderDeliveryMethod({
      shipping_address: null,
      shipping_lines: [{ title: 'Monsterthreads Head Office', code: 'pickup' }],
    })).toEqual({
      channel_shipping_method: 'Monsterthreads Head Office',
      channel_delivery_type: 'pickup',
    });
  });

  it('identifies a method with a shipping address as delivery', () => {
    expect(parseShopifyOrderDeliveryMethod({
      shipping_address: { address1: '12 Market Street' },
      shipping_lines: [{ title: 'Standard Shipping' }],
    })).toEqual({
      channel_shipping_method: 'Standard Shipping',
      channel_delivery_type: 'delivery',
    });
  });

  it('does not infer pickup from every addressless shipping method', () => {
    expect(parseShopifyOrderDeliveryMethod({
      shipping_address: null,
      shipping_lines: [{ title: 'Standard Shipping' }],
    })).toEqual({
      channel_shipping_method: 'Standard Shipping',
      channel_delivery_type: 'unknown',
    });
  });
});