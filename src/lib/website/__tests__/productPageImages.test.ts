import { describe, expect, it } from 'vitest';

import { extractProductPageImages } from '../productPageImages';

describe('extractProductPageImages', () => {
  it('keeps the selected product media family and rejects recommendation images', () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"ProductGroup","hasVariant":[{"@type":"Product","image":"https:\/\/shop.test\/cdn\/40009GA012_Flatlay_01.png?width=1920"}]}
      </script>
      <img src="http://shop.test/cdn/40009GA012_Flatlay_01_grande.png?width=950">
      <img src="https://shop.test/cdn/40009GA012_Onbody_01.jpg?width=950">
      <img src="https://shop.test/cdn/40009GA012_Campaign_01.jpg?width=950">
      <section class="recommendations">
        <img src="https://shop.test/cdn/50010GA004_Yellow_Dress.jpg?width=950">
        <img src="https://shop.test/cdn/20020GA001_Stripe_Top.jpg?width=950">
      </section>`;

    expect(extractProductPageImages(html, 'https://shop.test/products/wild-strawberry')).toEqual([
      'https://shop.test/cdn/40009GA012_Flatlay_01.png',
      'https://shop.test/cdn/40009GA012_Onbody_01.jpg',
      'https://shop.test/cdn/40009GA012_Campaign_01.jpg',
    ]);
  });

  it('returns only trusted structured images when no media family can be derived', () => {
    const html = `
      <meta property="og:image" content="https://shop.test/cdn/main-product.jpg">
      <img src="https://shop.test/cdn/unrelated-recommendation.jpg">`;

    expect(extractProductPageImages(html, 'https://shop.test/products/example')).toEqual([
      'https://shop.test/cdn/main-product.jpg',
    ]);
  });
});