import { describe, expect, it } from 'vitest';

import { extractLinkedProductUrls, isLikelyProductUrl, isProductPageUrl } from '../productUrlCandidates';

const product = { name: 'Willow Garden Wide Brim Hat', brand: 'Acme', code: 'WG-HAT' };

describe('product URL candidates', () => {
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
});