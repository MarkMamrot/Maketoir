import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));

import { getOrderPlannerBranchSales } from '../orderPlannerQuery';
import { IMS_SALES_LINES_SQL } from '../salesLinesQuery';

describe('Order Planner branch sales query', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ variant_id: 'variant-1', sales_qty: '90' }]);
  });

  it.each([7, 90, 180, 365])('binds the same %s-day range to all canonical sales sources and only selected locations', async window => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    const quantities = await getOrderPlannerBranchSales(['1', '2', '1'], window, now);
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain(IMS_SALES_LINES_SQL);
    expect(sql).toContain('s.location_id IN (?,?)');
    const from = new Date(now - window * 86400000).toISOString().slice(0, 10);
    expect(values).toEqual([from, '2026-10-14', from, '2026-10-14', from, '2026-10-14', '1', '2']);
    expect(quantities.get('variant-1')).toBe(90);
  });

  it('retains historical branch mapping and avoids double-counting mirrored POS and SO rows', () => {
    expect(IMS_SALES_LINES_SQL).toContain('hl.cin7_branch_id = h.branch_id');
    expect(IMS_SALES_LINES_SQL).toContain("ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0");
    expect(IMS_SALES_LINES_SQL).toContain('so.cin7_order_id IS NULL');
    expect(IMS_SALES_LINES_SQL).toContain("so.status NOT IN ('draft', 'cancelled')");
    expect(IMS_SALES_LINES_SQL).toContain('so.is_staff_preview_test = 0');
    expect(IMS_SALES_LINES_SQL).toContain('COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id)');
  });

  it('rejects an empty branch selection rather than querying all locations', async () => {
    await expect(getOrderPlannerBranchSales([], 90)).rejects.toThrow('Select at least one');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('propagates failed queries instead of returning zero sales', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    await expect(getOrderPlannerBranchSales(['1'], 90)).rejects.toThrow('database unavailable');
  });
});
