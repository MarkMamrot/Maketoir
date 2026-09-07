import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ query: mockPoolQuery }),
}));

import { loadAssistantSalesPerformance } from '../salesSummaryQuery';

describe('Assistant sales performance query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restricts results to active owned locations and reports attached COGS coverage', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ id: 4, name: 'Main' }, { id: 8, name: 'Outlet' }]])
      .mockResolvedValueOnce([[
        {
          location_id: 4, location_name: 'Main', sales_qty: '10', sales_amount: '220',
          attached_cogs: '60', covered_qty: '5', covered_amount: '110',
        },
        {
          location_id: 8, location_name: 'Outlet', sales_qty: '2', sales_amount: '55',
          attached_cogs: '30', covered_qty: '2', covered_amount: '55',
        },
      ]]);

    const result = await loadAssistantSalesPerformance({
      businessId: 'biz-1', fromDate: '2026-08-01', toDate: '2026-08-22', locationIds: [4, 8, 99],
    });

    expect(mockPoolQuery.mock.calls[0]).toEqual([
      'SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
      ['biz-1'],
    ]);
    expect(mockPoolQuery.mock.calls[1][0]).toContain('p.business_id = ?');
    expect(mockPoolQuery.mock.calls[1][0]).toContain('l.business_id = ?');
    expect(mockPoolQuery.mock.calls[1][0]).toContain('s.location_id IN (?,?)');
    expect(mockPoolQuery.mock.calls[1][1].slice(-4)).toEqual(['biz-1', 'biz-1', 4, 8]);
    expect(result.rows[0]).toMatchObject({
      salesAmountTaxInclusive: 220,
      coveredSalesAmountTaxInclusive: 110,
      attachedCogs: 60,
      grossProfit: 40,
      grossProfitPercent: 40,
      cogsCoveragePercent: 50,
    });
    expect(result.totals).toMatchObject({
      salesAmountTaxInclusive: 275,
      coveredSalesAmountTaxInclusive: 165,
      attachedCogs: 90,
      grossProfit: 60,
      grossProfitPercent: 40,
      cogsCoveragePercent: 60,
    });
  });

  it('does not run the sales union when no requested location is active', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id: 4, name: 'Main' }]]);

    await expect(loadAssistantSalesPerformance({
      businessId: 'biz-1', fromDate: '2026-08-01', toDate: '2026-08-22', locationIds: [99],
    })).resolves.toEqual({ rows: [], totals: null });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });
});
