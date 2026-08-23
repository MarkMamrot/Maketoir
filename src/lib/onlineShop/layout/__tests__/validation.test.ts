import { describe, expect, it } from 'vitest';

import { createDefaultOnlineShopLayout, normalizeOnlineShopContentPage, normalizeOnlineShopLayoutDocument } from '../validation';

describe('online shop layout validation', () => {
  it('defines routed product ordering and a first-class checkout independently of wholesale', () => {
    const layout = createDefaultOnlineShopLayout();
    expect(layout.pages.product.sections.map(section => section.type)).toEqual(['shop_product_media', 'shop_product_purchase']);
    expect(layout.pages.checkout.sections.map(section => section.type)).toEqual(['shop_checkout']);
    expect(layout.pages.catalogue.sections.map(section => section.type)).toEqual(['shop_catalogue']);
  });

  it('restores native required sections and removes page-incompatible systems', () => {
    const layout = normalizeOnlineShopLayoutDocument({ schemaVersion: 1, pages: {
      catalogue: { sections: [{ id: 'bad', type: 'shop_product_purchase', settings: {} }, { id: 'hero', type: 'banner', settings: { heading: 'Shop' } }] },
    } });
    expect(layout.pages.catalogue.sections.map(section => section.type)).toEqual(['banner', 'shop_catalogue']);
  });

  it('allows sanitized shared content but rejects commerce systems on custom pages', () => {
    const page = normalizeOnlineShopContentPage({ schemaVersion: 1, sections: [
      { id: 'returns', type: 'rich_text', settings: { bodyHtml: '<p onclick="bad()">Returns <strong>accepted</strong><script>bad()</script></p>' } },
      { id: 'checkout', type: 'shop_checkout', settings: {} },
    ] });
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0].settings.bodyHtml).toBe('<p>Returns <strong>accepted</strong></p>');
  });
});