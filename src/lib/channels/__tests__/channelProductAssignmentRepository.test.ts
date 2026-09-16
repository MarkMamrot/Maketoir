import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), connectionQuery: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.query,
  imsExecute: mocks.execute,
  getIMSPool: () => ({ getConnection: async () => ({ query: mocks.connectionQuery, beginTransaction: mocks.begin,
    commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) }),
}));

import {
  evaluateChannelProducts,
  replaceChannelProductRules,
  setChannelProductOverride,
} from '../channelProductAssignmentRepository';

describe('channel product assignment repository', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ affectedRows: 1 }); });

  it('replaces one exact channel rule set in a transaction', async () => {
    mocks.connectionQuery.mockResolvedValue([{}, []]);
    mocks.query.mockResolvedValue([{ id: 9, name: 'Ready', priority: 10, is_enabled: 1, match_mode: 'all',
      decision: 'include', conditions_json: '[{"field":"online_candidate","operator":"equals","value":true}]' }]);
    await replaceChannelProductRules({ businessId: 'business-1', channelInstanceId: 'instance-1', rules: [{
      name: 'Ready', conditions: [{ field: 'online_candidate', operator: 'equals', value: true }],
    }] });
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.connectionQuery.mock.calls[0][1]).toEqual(['business-1', 'instance-1']);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('previews and applies an effective decision without replacing provider state', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 9, name: 'Ready', priority: 10, is_enabled: 1, match_mode: 'all',
        decision: 'include', conditions_json: '[{"field":"online_candidate","operator":"equals","value":true}]' }])
      .mockResolvedValueOnce([{ product_id: 'product-1', product_name: 'Dress', is_online: 1, is_active: 1,
        is_stock_item: 1, description: 'Ready', website_title: 'Dress', product_type: 'Dress', category: 'Apparel',
        subcategory: null, brand: 'Brand', tags: 'featured', image_count: 2, variant_count: 3,
        override_mode: 'exclude', provider_state: 'published' }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const result = await evaluateChannelProducts({ businessId: 'business-1', channelInstanceId: 'instance-1', apply: true });
    expect(result.products[0]).toMatchObject({ ruleDecision: 'include', effectiveDecision: 'exclude',
      overrideMode: 'exclude', providerState: 'published' });
    expect(mocks.execute.mock.calls[0][0]).not.toContain('provider_state =');
    expect(mocks.execute.mock.calls[0][1].slice(0, 3)).toEqual(['business-1', 'instance-1', 'product-1']);
    expect(result.applied).toBe(1);
  });

  it('updates an override only for a product in the exact business and channel', async () => {
    await setChannelProductOverride({ businessId: 'business-1', channelInstanceId: 'instance-1',
      productId: 'product-1', overrideMode: 'include' });
    expect(mocks.execute.mock.calls[0][0]).toContain('product.business_id = ? AND product.product_id = ?');
    expect(mocks.execute.mock.calls[0][1]).toEqual(['instance-1', 'include', 'include', 'business-1', 'product-1']);
  });

  it('evaluates one exact product without using a fuzzy search match', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ product_id: 'product-1', product_name: 'Dress', is_online: 1, is_active: 1,
        is_stock_item: 1, description: null, website_title: null, product_type: null, category: null,
        subcategory: null, brand: null, tags: null, image_count: 0, variant_count: 1,
        override_mode: null, provider_state: null }])
      .mockResolvedValueOnce([{ total: 1 }]);

    const result = await evaluateChannelProducts({ businessId: 'business-1', channelInstanceId: 'instance-1',
      productId: 'product-1', limit: 1 });

    expect(mocks.query.mock.calls[1][0]).toContain('product.product_id = ?');
    expect(mocks.query.mock.calls[1][1]).toEqual(['instance-1', 'business-1', 'product-1', 1, 0]);
    expect(mocks.query.mock.calls[2][1]).toEqual(['business-1', 'product-1']);
    expect(result.products).toHaveLength(1);
  });
});