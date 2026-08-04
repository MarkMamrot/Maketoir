import { describe, expect, it } from 'vitest';

import { extractProductPageFacts, extractShopifyProductFacts } from '../productPageFacts';

describe('extractProductPageFacts', () => {
  it('keeps exact product facts and excludes policies and related-product data', () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Product","name":"Big Hugo the Mallard Duck","brand":{"name":"Nana Huchy"},"sku":"HUGD-LG","description":"An oversized soft mallard made for memorable cuddles."}
      </script>
      <details><summary>DETAILS &amp; DIMENSIONS</summary><div><p>Measures 52cm sitting down</p><p>Suitable for 0+</p><p>Cold gentle machine wash.</p></div></details>
      <details><summary>Shipping &amp; Delivery</summary><p>Free shipping over $120.</p></details>
      <section class="recommendations"><h3>Hugo the Mallard Duck</h3><p>Measures 44cm sitting down</p></section>`;

    const facts = extractProductPageFacts(html, 'https://nanahuchy.com.au/products/big-hugo-the-duck');

    expect(facts).toContain('Measures 52cm sitting down');
    expect(facts).toContain('oversized soft mallard');
    expect(facts).not.toContain('44cm');
    expect(facts).not.toContain('Free shipping');
  });
});

describe('extractShopifyProductFacts', () => {
  it('extracts source-bound identity and description from product JSON', () => {
    const facts = extractShopifyProductFacts({
      title: 'Long Sleeve Bodysuit / Flutterby',
      vendor: 'Halcyon Nights',
      type: 'Bodysuit',
      description: '<p>Long sleeves and a two-way zip for easy changes.</p>',
      variants: [{ sku: 'LSB-FLU-0-3M', barcode: '934000000001' }],
    }, 'https://shop.test/products/flutterby-long-sleeve-bodysuit.js?srsltid=test');

    expect(facts).toContain('APPROVED SOURCE: https://shop.test/products/flutterby-long-sleeve-bodysuit');
    expect(facts).toContain('Product: Long Sleeve Bodysuit / Flutterby');
    expect(facts).toContain('Brand: Halcyon Nights');
    expect(facts).toContain('SKU: LSB-FLU-0-3M');
    expect(facts).toContain('Long sleeves and a two-way zip for easy changes.');
    expect(facts).not.toContain('<p>');
  });

  it('ignores malformed numeric storefront metadata', () => {
    const facts = extractShopifyProductFacts({ title: 'Flutterby Bodysuit', vendor: 0 }, 'https://shop.test/products/flutterby.js');

    expect(facts).toContain('Product: Flutterby Bodysuit');
    expect(facts).not.toContain('Brand: 0');
  });
});