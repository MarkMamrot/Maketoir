import { describe, expect, it } from 'vitest';

import { PRODUCT_RESEARCH_RULES, productResearchQuery, productSearchQueries, selectProductResearchVariant } from '../productResearchRules';

describe('product research rules', () => {
  it('excludes retailer logistics and distinguishes product dimensions', () => {
    expect(PRODUCT_RESEARCH_RULES).toContain('shipping costs');
    expect(PRODUCT_RESEARCH_RULES).toContain('product dimensions');
    expect(PRODUCT_RESEARCH_RULES).toContain('packaging dimensions');
    expect(PRODUCT_RESEARCH_RULES).toContain('Never infer or invent dimensions');
  });

  it('grounds a URL query in product facts rather than site policies', () => {
    const query = productResearchQuery('Test Product', 'Test Brand', 'https://supplier.example/product');
    expect(query).toContain('https://supplier.example/product');
    expect(query).toContain('dimensions or measurements');
    expect(query).toContain('Exclude shipping');
  });

  it('adds exact SKU and barcode searches without replacing the broad product search', () => {
    expect(productSearchQueries(
      'Asobu: Bestie Bottle 460ml - Crocodile',
      'Asobu',
      'AS-SBV44-CROCODILE',
      '842591060632',
    )).toEqual([
      '"Asobu: Bestie Bottle 460ml - Crocodile"',
      'Asobu: Bestie Bottle 460ml - Crocodile',
      'Asobu: Bestie Bottle 460ml - Crocodile "AS-SBV44-CROCODILE"',
      'Asobu: Bestie Bottle 460ml - Crocodile "842591060632"',
    ]);
  });

  it('omits missing, short, and duplicate identifiers', () => {
    expect(productSearchQueries('Test Product', 'Test Brand', '123', '123')).toEqual([
      '"Test Product" Test Brand',
      'Test Product Test Brand',
    ]);
  });

  it('leads with the exact reported product name while keeping SKU as supporting evidence', () => {
    expect(productSearchQueries(
      'A Dopo 8 Oz Handpainted Blue Cheetahs',
      'Paddywax',
      'AD0815BXAU',
    )).toEqual([
      '"A Dopo 8 Oz Handpainted Blue Cheetahs" Paddywax',
      'A Dopo 8 Oz Handpainted Blue Cheetahs Paddywax',
      'A Dopo 8 Oz Handpainted Blue Cheetahs Paddywax "AD0815BXAU"',
    ]);
  });

  it('selects the variant whose option and SKU match the product title', () => {
    const variants = [
      { sku: 'AS-SBV44-CAT', barcode: 'cat-code', option1_value: 'Cat' },
      { sku: 'AS-SBV44-CROCODILE', barcode: '842591060632', option1_value: 'Crocodile' },
    ];

    expect(selectProductResearchVariant('Asobu: Bestie Bottle 460ml - Crocodile', variants)).toBe(variants[1]);
  });

  it('keeps the first variant when the title does not identify a variant', () => {
    const variants = [
      { sku: 'STYLE-RED', option1_value: 'Red' },
      { sku: 'STYLE-BLUE', option1_value: 'Blue' },
    ];

    expect(selectProductResearchVariant('Plain Bottle', variants)).toBe(variants[0]);
  });
});
