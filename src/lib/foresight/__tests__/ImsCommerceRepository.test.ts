import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockRunImsForBusiness } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));

import { ImsCommerceRepository } from '../repositories/ImsCommerceRepository';

describe('ImsCommerceRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockImsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_orders so')) {
        return [{
          metric_date: '2026-07-28', sales_inc_tax: '1100', sales_tax: '100', sales_cogs: '400',
          order_count: '10', cost_line_count: '20', missing_cost_line_count: '0', captured_cost_line_count: '20',
        }];
      }
      if (sql.includes('FROM pos_sales ps')) return [];
      if (sql.includes('FROM ims_credit_notes cn')) {
        return [{
          metric_date: '2026-07-28', channel: 'online', returns_inc_tax: '110', returns_tax: '10',
          returned_cogs: '40', return_count: '1', cost_line_count: '1', missing_cost_line_count: '0',
        }];
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    });
  });

  it('runs inside explicit tenant context and merges ledger returns once', async () => {
    const rows = await ImsCommerceRepository.getDailyCommerce('business-1', '2026-07-28', '2026-07-28');

    expect(mockRunImsForBusiness).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(rows).toEqual([{
      metricDate: '2026-07-28',
      channel: 'online',
      salesIncTax: 1100,
      salesTax: 100,
      returnsIncTax: 110,
      returnsTax: 10,
      salesCogs: 400,
      returnedCogs: 40,
      orderCount: 10,
      returnCount: 1,
      costLineCount: 21,
      missingCostLineCount: 0,
      costBasis: 'mixed',
    }, {
      metricDate: '2026-07-28',
      channel: 'pos',
      salesIncTax: 0,
      salesTax: 0,
      returnsIncTax: 0,
      returnsTax: 0,
      salesCogs: 0,
      returnedCogs: 0,
      orderCount: 0,
      returnCount: 0,
      costLineCount: 0,
      missingCostLineCount: 0,
      costBasis: 'estimated',
    }]);
  });

  it('does not count POS return transactions as sales', async () => {
    await ImsCommerceRepository.getDailyCommerce('business-1', '2026-07-28', '2026-07-28');

    const onlineSql = mockImsQuery.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes('FROM ims_sales_orders so'));
    expect(onlineSql).toContain("UPPER(COALESCE(pv.sku, '')) != 'SHOPIFY-MISC'");
    const posSql = mockImsQuery.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes('FROM pos_sales ps'));
    expect(posSql).toContain("ps.sale_type = 'sale'");
    const returnsSql = mockImsQuery.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes('FROM ims_credit_notes cn'));
    expect(returnsSql).toContain("cn.source IN ('shopify', 'pos')");
    expect(returnsSql).toContain("UPPER(COALESCE(pv.sku, '')) != 'SHOPIFY-MISC'");
  });
});