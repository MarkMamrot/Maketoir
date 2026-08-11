import { describe, expect, it } from 'vitest';

import { canonicalProductCandidateUrl, extractLinkedProductUrls, isLikelyProductUrl, isProductPageUrl } from '../productUrlCandidates';

const product = { name: 'Willow Garden Wide Brim Hat', brand: 'Acme', code: 'WG-HAT' };

describe('product URL candidates', () => {
  it('removes tracking parameters while retaining product-selection parameters', () => {
    expect(canonicalProductCandidateUrl('https://retailer.test/products/bottle?variant=123&srsltid=abc&utm_source=google#details')).toBe(
      'https://retailer.test/products/bottle?variant=123',
    );
  });

  it('rejects category pages and accepts matching product pages', () => {
    expect(isLikelyProductUrl('https://supplier.test/collections/hats', product)).toBe(false);
    expect(isLikelyProductUrl('https://supplier.test/products/willow-garden-wide-brim-hat', product)).toBe(true);
  });

  it('discovers a matching product linked from a supplier category page', () => {
    const html = `
      <a href="/products/other-bucket-hat">Other Bucket Hat</a>
      <a href="/products/willow-garden-wide-brim-hat?variant=1">Willow Garden Wide Brim Hat</a>
      <a href="https://other.test/products/willow-garden-wide-brim-hat">External result</a>`;

    expect(extractLinkedProductUrls(html, 'https://supplier.test/collections/hats', product)).toEqual([
      'https://supplier.test/products/willow-garden-wide-brim-hat?variant=1',
    ]);
  });

  it('uses an exact SKU when the product name is generic', () => {
    const html = '<a href="/products/new-arrival-wg-hat">View new arrival WG-HAT</a>';
    expect(extractLinkedProductUrls(html, 'https://supplier.test/collections/new', product)).toEqual([
      'https://supplier.test/products/new-arrival-wg-hat',
    ]);
  });

  it('keeps product-path pages as a conservative search fallback without admitting categories', () => {
    expect(isProductPageUrl('https://retailer.test/products/style-12345')).toBe(true);
    expect(isProductPageUrl('https://retailer.test/collections/wide-brim-hats')).toBe(false);
    expect(isProductPageUrl('https://retailer.test/search?q=willow')).toBe(false);
  });

  it('uses Google title and snippet evidence when a retailer URL omits the product identity', () => {
    const candle = { name: 'A Dopo 8 Oz Handpainted Blue Cheetahs', brand: 'Paddywax', code: 'AD0815BXAU' };
    const url = 'https://retailer.test/p/seasonal-candle-4815';
    const label = 'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic Candle by Paddywax AD0815BXAU';

    expect(isLikelyProductUrl(url, candle)).toBe(false);
    expect(isLikelyProductUrl(url, candle, label)).toBe(true);
  });

  it('does not abort scoring when Google result text contains a malformed percent sequence', () => {
    const candle = { name: 'A Dopo Blue Cheetahs Candle', brand: 'Paddywax', code: 'AD0815BXAU' };
    expect(isLikelyProductUrl(
      'https://retailer.test/products/a-dopo-blue-cheetahs-candle?discount=20%off',
      candle,
      'Paddywax A Dopo Blue Cheetahs 20% off',
    )).toBe(true);
  });

  it('rejects social-media posts even when their path resembles a product page', () => {
    expect(canonicalProductCandidateUrl('https://www.instagram.com/p/DZNtp2alCAr/')).toBeNull();
    expect(isProductPageUrl('https://www.instagram.com/p/DZNtp2alCAr/')).toBe(false);
  });
});