import { describe, expect, it } from 'vitest';

import { evaluateChannelProductRules, type ChannelProductRuleContext } from '../channelProductRules';

const product: ChannelProductRuleContext = {
  online_candidate: true,
  active: true,
  stock_item: true,
  description: 'A finished description',
  website_title: 'Summer dress',
  product_type: 'Dress',
  category: 'Apparel',
  subcategory: 'Dresses',
  brand: 'Monsterthreads',
  tags: ['summer', 'featured'],
  image_count: 3,
  variant_count: 4,
};

describe('evaluateChannelProductRules', () => {
  it('uses the first matching enabled rule by priority', () => {
    const result = evaluateChannelProductRules({ context: product, rules: [
      { id: 20, name: 'General online', priority: 20, enabled: true, matchMode: 'all', decision: 'include',
        conditions: [{ field: 'online_candidate', operator: 'equals', value: true }] },
      { id: 10, name: 'Exclude dresses', priority: 10, enabled: true, matchMode: 'all', decision: 'exclude',
        conditions: [{ field: 'product_type', operator: 'equals', value: 'dress' }] },
    ] });
    expect(result).toMatchObject({ ruleDecision: 'exclude', effectiveDecision: 'exclude', matchedRuleId: 10 });
  });

  it('supports content, image, tag, and exclusion conditions', () => {
    const result = evaluateChannelProductRules({ context: product, rules: [{
      id: 1, name: 'Ready products', priority: 1, enabled: true, matchMode: 'all', decision: 'include',
      conditions: [
        { field: 'online_candidate', operator: 'equals', value: true },
        { field: 'description', operator: 'is_present' },
        { field: 'image_count', operator: 'greater_than_or_equal', value: 2 },
        { field: 'tags', operator: 'contains', value: 'featured' },
        { field: 'product_type', operator: 'not_equals', value: 'Gift Card' },
      ],
    }] });
    expect(result).toMatchObject({ ruleDecision: 'include', matchedRuleName: 'Ready products' });
  });

  it('defaults to exclusion when no rule matches', () => {
    const result = evaluateChannelProductRules({ context: { ...product, online_candidate: false }, rules: [{
      id: 1, name: 'Online candidates', priority: 1, enabled: true, matchMode: 'all', decision: 'include',
      conditions: [{ field: 'online_candidate', operator: 'equals', value: true }],
    }] });
    expect(result).toMatchObject({ ruleDecision: 'exclude', effectiveDecision: 'exclude', matchedRuleId: null });
  });

  it('applies persistent include and exclude overrides after rule evaluation', () => {
    const rule = { id: 1, name: 'Online candidates', priority: 1, enabled: true, matchMode: 'all' as const,
      decision: 'include' as const, conditions: [{ field: 'online_candidate' as const, operator: 'equals' as const, value: true }] };
    expect(evaluateChannelProductRules({ context: product, rules: [rule], overrideMode: 'exclude' }).effectiveDecision).toBe('exclude');
    expect(evaluateChannelProductRules({ context: { ...product, online_candidate: false }, rules: [rule], overrideMode: 'include' }).effectiveDecision).toBe('include');
  });
});