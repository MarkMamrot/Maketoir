import { describe, expect, it } from 'vitest';

import { PRODUCT_RESEARCH_RULES, productResearchQuery } from '../productResearchRules';

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
});