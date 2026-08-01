import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockRunImsForBusiness } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));

import { ImsBrandPerformanceRepository } from '../repositories/ImsBrandPerformanceRepository';

describe('ImsBrandPerformanceRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockImsQuery.mockResolvedValue([{
      brand: 'Legami', quantity: '42', revenue: '1234.50', history_revenue: '900',
      pos_revenue: '134.50', online_revenue: '200', wholesale_revenue: '0', product_count: '8',
    }]);
  });

  it('uses canonical non-overlapping sales sources inside explicit tenant context', async () => {
    const rows = await ImsBrandPerformanceRepository.listBrandPerformance(
      'business-1', '2026-05-04', '2026-08-01', [' Legami '], 10,
    );

    expect(mockRunImsForBusiness).toHaveBeenCalledWith('business-1', expect.any(Function));
    const [sql, params] = mockImsQuery.mock.calls[0];
    expect(sql).toContain('COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id)');
    expect(sql).toContain("ps.is_historical = 0");
    expect(sql).toContain('so.cin7_order_id IS NULL');
    expect(sql).toContain('p.business_id = ?');
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual([
      '2026-05-04', '2026-08-01', '2026-05-04', '2026-08-01', '2026-05-04', '2026-08-01',
      'business-1', 'legami',
    ]);
    expect(rows).toEqual([{
      brand: 'Legami', quantity: 42, revenue: 1234.5, historyRevenue: 900,
      posRevenue: 134.5, onlineRevenue: 200, wholesaleRevenue: 0, productCount: 8,
    }]);
  });
});