import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { validateWholesaleOrderItems, WholesaleItemValidationError } from '../wholesaleOrderItems';

const row = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Board', brand: 'Acme', sku: 'SKU-1',
  option1_value: 'Blue', option2_value: null, option3_value: null, price_wholesale: 42,
};

describe('validateWholesaleOrderItems', () => {
  beforeEach(() => mockImsQuery.mockReset());

  it('uses authoritative tenant product fields and wholesale price', async () => {
    mockImsQuery.mockResolvedValue([row]);
    const result = await validateWholesaleOrderItems('biz-1', { mode: 'all', brands: [] }, [{
      variant_id: 'v-1', qty: 2, product_name: 'Forged', unit_price: 1,
    }]);
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'v-1']);
    expect(result[0]).toEqual(expect.objectContaining({ product_name: 'Board', unit_price: 42, qty: 2, variant_label: 'Blue' }));
  });

  it('rejects a variant outside the contact brand allowlist', async () => {
    mockImsQuery.mockResolvedValue([row]);
    await expect(validateWholesaleOrderItems('biz-1', { mode: 'selected', brands: ['Beta'] }, [{ variant_id: 'v-1', qty: 1 }]))
      .rejects.toThrow('not available for this wholesale account');
  });

  it('rejects missing products, invalid quantities, and duplicate variants', async () => {
    mockImsQuery.mockResolvedValue([]);
    await expect(validateWholesaleOrderItems('biz-1', { mode: 'all', brands: [] }, [{ variant_id: 'v-1', qty: 1 }]))
      .rejects.toBeInstanceOf(WholesaleItemValidationError);
    await expect(validateWholesaleOrderItems('biz-1', { mode: 'all', brands: [] }, [{ variant_id: 'v-1', qty: 1.5 }]))
      .rejects.toThrow('whole-number quantity');
    await expect(validateWholesaleOrderItems('biz-1', { mode: 'all', brands: [] }, [{ variant_id: 'v-1', qty: 1 }, { variant_id: 'v-1', qty: 2 }]))
      .rejects.toThrow('Duplicate variants');
  });
});