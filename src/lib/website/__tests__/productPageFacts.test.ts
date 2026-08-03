import { describe, expect, it } from 'vitest';

import { extractProductPageFacts } from '../productPageFacts';

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