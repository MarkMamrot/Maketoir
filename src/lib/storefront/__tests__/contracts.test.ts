import { describe, expect, it } from 'vitest';

import { parseOnlineSalesChannel } from '../channel';
import { normalizeStorefrontCart } from '../commerce';
import { storefrontCanonicalUrl, storefrontContentPagePath, storefrontProductPath } from '../routes';
import { sanitizeStorefrontHtml } from '../layoutValidation';

const context = {
  channel: 'native_shop' as const,
  businessId: 'business-1',
  slug: 'shop-one',
  basePath: '/shop/shop-one',
  canonicalOrigin: 'https://shop.example.com',
};

describe('storefront contracts', () => {
  it('defaults unknown online channels to none', () => {
    expect(parseOnlineSalesChannel('shopify')).toBe('shopify');
    expect(parseOnlineSalesChannel('native_shop')).toBe('native_shop');
    expect(parseOnlineSalesChannel('other')).toBe('none');
  });

  it('normalizes, combines, and bounds individual-unit cart lines', () => {
    expect(normalizeStorefrontCart({ lines: [
      { variantId: 'variant-1', quantity: 2 },
      { variantId: 'variant-1', quantity: 3 },
      { variantId: 'variant-2', quantity: 1.5 },
      { variantId: '', quantity: 1 },
    ] })).toEqual({ lines: [{ variantId: 'variant-1', quantity: 5 }] });
  });

  it('centralizes path and canonical URL generation for future custom domains', () => {
    expect(storefrontProductPath(context, 'red shirt')).toBe('/shop/shop-one/products/red%20shirt');
    expect(storefrontContentPagePath(context, 'returns')).toBe('/shop/shop-one/pages/returns');
    expect(storefrontCanonicalUrl(context, 'products/red-shirt')).toBe('https://shop.example.com/shop/shop-one/products/red-shirt');
  });

  it('keeps supported rich-text formatting and strips unsafe styles and links', () => {
    const html = sanitizeStorefrontHtml('<p style="text-align: center; position: fixed"><span style="font-family: Georgia, serif; font-size: 20px; color: #123abc; background-image: url(javascript:alert(1))">Hello</span><a href="javascript:alert(1)">bad</a></p>');
    expect(html).toContain('text-align:center');
    expect(html).toContain('font-family:Georgia, serif');
    expect(html).toContain('font-size:20px');
    expect(html).toContain('color:#123abc');
    expect(html).not.toContain('position');
    expect(html).not.toContain('background-image');
    expect(html).not.toContain('javascript:');
  });
});