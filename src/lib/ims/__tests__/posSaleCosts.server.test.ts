import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { enrichPosSaleItemsWithCosts } from '../posSaleCosts.server';

describe('enrichPosSaleItemsWithCosts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves a captured zero movement cost instead of showing current catalogue cost', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ variant_id: 'variant-1', avg_cost: null, cost_aud: '0.48' }])
      .mockResolvedValueOnce([{ sale_id: 580915, variant_id: 'variant-1', unit_cost: '0.00' }]);

    const [item] = await enrichPosSaleItemsWithCosts([{ sale_id: 580915, variant_id: 'variant-1' }]);

    expect(item).toMatchObject({ unit_cost: 0, avg_cost: 0, cost_source: 'movement' });
  });

  it('uses catalogue cost only when no stock movement exists', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ variant_id: 'variant-1', avg_cost: null, cost_aud: '0.48' }])
      .mockResolvedValueOnce([]);

    const [item] = await enrichPosSaleItemsWithCosts([{ sale_id: 580915, variant_id: 'variant-1' }]);

    expect(item).toMatchObject({ avg_cost: 0.48, cost_source: 'catalogue_fallback' });
  });
});