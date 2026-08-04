import { describe, expect, it } from 'vitest';

import { extractProductPageImageCandidates, extractProductPageImages, extractShopifyProductImages } from '../productPageImages';

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

  it('collects explicitly marked gallery images with different filenames', () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Product","image":"https:\/\/shop.test\/cdn\/big-hugo-the-duck-123.jpg?width=1920"}
      </script>
      <div class="product-media-wrapper">
        <a class="block show-gallery" href="//shop.test/cdn/big-hugo-the-duck-123.jpg?width=5000" aria-label="Load image 1 in gallery view"></a>
        <a class="block show-gallery" href="//shop.test/cdn/big-hugo-the-mallard-duck-456.jpg?width=5000" aria-label="Load image 2 in gallery view"></a>
        <a class="block show-gallery" href="//shop.test/cdn/big-hugo-the-duck-124.jpg?width=5000" aria-label="Load image 3 in gallery view"></a>
        <a class="block show-gallery" href="//shop.test/cdn/big-buddy-hugo-bundle-789.jpg?width=5000" aria-label="Load image 4 in gallery view"></a>
      </div>
      <section class="recommendations">
        <a href="//shop.test/cdn/mini-hugo-rattle.jpg"><img src="//shop.test/cdn/mini-hugo-rattle.jpg"></a>
      </section>`;

    expect(extractProductPageImages(html, 'https://shop.test/products/big-hugo-the-duck')).toEqual([
      'https://shop.test/cdn/big-hugo-the-duck-123.jpg',
      'https://shop.test/cdn/big-hugo-the-mallard-duck-456.jpg',
      'https://shop.test/cdn/big-hugo-the-duck-124.jpg',
      'https://shop.test/cdn/big-buddy-hugo-bundle-789.jpg',
    ]);
  });

  it('collects Dawn product media items while keeping broader page images separate', () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"ProductGroup","image":"https:\/\/shop.test\/cdn\/Flutterby_LS-Bodysuit_01.png?width=1920"}
      </script>
      <ul class="product__media-list">
        <li class="product__media-item" data-media-id="1"><img src="//shop.test/cdn/Flutterby_LS-Bodysuit_01.png?width=74" srcset="//shop.test/cdn/Flutterby_LS-Bodysuit_01.png?width=600 600w"></li>
        <li class="product__media-item" data-media-id="2"><img src="//shop.test/cdn/flutterby-long-sleeve-bodysuit-01.jpg?width=74"></li>
        <li class="product__media-item" data-media-id="3"><img src="//shop.test/cdn/flutterby-long-sleeve-bodysuit-02.jpg?width=74"></li>
      </ul>
      <section class="recommendations"><img src="//shop.test/cdn/Flutterby_Sherpa-Jacket_01.png?width=360"></section>`;

    const candidates = extractProductPageImageCandidates(html, 'https://shop.test/products/flutterby');
    expect(candidates.images).toEqual([
      'https://shop.test/cdn/Flutterby_LS-Bodysuit_01.png',
      'https://shop.test/cdn/flutterby-long-sleeve-bodysuit-01.jpg',
      'https://shop.test/cdn/flutterby-long-sleeve-bodysuit-02.jpg',
    ]);
    expect(candidates.fallbackImages).toContain('https://shop.test/cdn/Flutterby_Sherpa-Jacket_01.png');
    expect(candidates.images).not.toContain('https://shop.test/cdn/Flutterby_Sherpa-Jacket_01.png');
  });

  it('collects exact Shopify product JSON images when theme HTML is unavailable', () => {
    const payload = {
      title: 'Long Sleeve Bodysuit / Flutterby',
      images: [
        '//cdn.shopify.com/files/Flutterby_LS-Bodysuit_01.png?width=1946',
        '//cdn.shopify.com/files/flutterby-long-sleeve-bodysuit-01.jpg?width=1946',
        { src: '//cdn.shopify.com/files/flutterby-long-sleeve-bodysuit-02.jpg?width=1946' },
      ],
    };

    expect(extractShopifyProductImages(payload, 'https://shop.test/products/flutterby.js')).toEqual([
      'https://cdn.shopify.com/files/Flutterby_LS-Bodysuit_01.png',
      'https://cdn.shopify.com/files/flutterby-long-sleeve-bodysuit-01.jpg',
      'https://cdn.shopify.com/files/flutterby-long-sleeve-bodysuit-02.jpg',
    ]);
  });
});