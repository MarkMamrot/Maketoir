import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockStockList, mockLocationsList, mockBrandProfileGet } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockStockList: vi.fn(),
  mockLocationsList: vi.fn(),
  mockBrandProfileGet: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsStockRepo: { list: mockStockList },
  ImsLocationsRepo: { list: mockLocationsList },
}));
vi.mock('@/lib/db/BrandProfileRepository', () => ({
  BrandProfileRepository: { get: mockBrandProfileGet },
}));

import { executeCustomerServiceTool } from '../businessDataTools';

describe('customer-service business data tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unknown and disabled tools before querying', async () => {
    await expect(executeCustomerServiceTool({ businessId: 'biz-1', enabledTools: [], name: 'drop_database' }))
      .rejects.toThrow('Unknown customer-service tool');
    await expect(executeCustomerServiceTool({ businessId: 'biz-1', enabledTools: [], name: 'search_products' }))
      .rejects.toThrow('disabled');
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('scopes product searches to the business and caps the result limit', async () => {
    mockImsQuery.mockResolvedValue([]);
    await executeCustomerServiceTool({
      businessId: 'biz-1',
      enabledTools: ['search_products'],
      name: 'search_products',
      args: { query: 'red dress', limit: 999 },
    });

    expect(mockImsQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockImsQuery.mock.calls[0];
    expect(sql).toContain('p.business_id = ?');
    expect(params[0]).toBe('biz-1');
    expect(params.at(-1)).toBe(25);
    expect(sql).not.toContain('cost_aud');
  });

  it('reuses live stock levels and removes internal stock fields', async () => {
    mockImsQuery.mockResolvedValue([{ variant_id: 'variant-1' }]);
    mockStockList.mockResolvedValue([{
      sku: 'SKU-1', product_name: 'Dress', variant_label: 'Red / 10', location_name: 'City',
      qty_on_hand: 5, qty_committed: 2, available: 3, qty_incoming: 4, avg_cost: 12, bin: 'A1', updated_at: '2026-07-28',
    }]);

    const result = await executeCustomerServiceTool({
      businessId: 'biz-1', enabledTools: ['get_stock_by_branch'], name: 'get_stock_by_branch', args: { sku: 'SKU-1' },
    });

    expect(mockStockList).toHaveBeenCalledWith('variant-1', undefined, 'biz-1');
    expect(result.data).toEqual([{
      sku: 'SKU-1', productName: 'Dress', option: 'Red / 10', branch: 'City',
      onHand: 5, committed: 2, available: 3, incoming: 4, updatedAt: '2026-07-28',
    }]);
    expect(JSON.stringify(result.data)).not.toContain('avg_cost');
    expect(JSON.stringify(result.data)).not.toContain('bin');
  });

  it('validates customer email arguments', async () => {
    await expect(executeCustomerServiceTool({
      businessId: 'biz-1', enabledTools: ['find_customer_by_email'], name: 'find_customer_by_email', args: { email: 'invalid' },
    })).rejects.toThrow('valid address');
    expect(mockImsQuery).not.toHaveBeenCalled();
  });
});