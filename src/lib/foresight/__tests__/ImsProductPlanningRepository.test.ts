import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockRunImsForBusiness } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));

import { ImsProductPlanningRepository } from '../repositories/ImsProductPlanningRepository';

describe('ImsProductPlanningRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockImsQuery.mockResolvedValue([{
      variant_id: 'variant-1', sku: 'SKU-1', product_name: 'Music Box', variant_label: '',
      brand: 'Kikkerland', product_type: 'Gifts', is_online: 1,
      price_inc_tax: '55.00', average_cost_ex_tax: '20.00', sales_qty_90d: '9',
      global_soh: '30', global_available: '27', global_incoming: '10', cache_updated_at: '2026-08-01 09:00:00',
    }]);
  });

  it('runs in explicit tenant context and uses organization-wide average cost', async () => {
    const rows = await ImsProductPlanningRepository.listProductPlanningRows('business-1', 25);

    expect(mockRunImsForBusiness).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('v.avg_cost AS average_cost_ex_tax'), ['business-1', 'business-1']);
    expect(mockImsQuery.mock.calls[0][0]).toContain('LIMIT 25');
    expect(rows).toEqual([{
      variantId: 'variant-1', sku: 'SKU-1', productName: 'Music Box', variantLabel: 'Default',
      brand: 'Kikkerland', productType: 'Gifts', isOnline: true, priceIncTax: 55,
      averageCostExTax: 20, salesQuantity90Days: 9, stockOnHand: 30,
      stockAvailable: 27, stockIncoming: 10, cacheUpdatedAt: '2026-08-01 09:00:00',
    }]);
  });
});