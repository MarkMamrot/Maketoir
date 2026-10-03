import { describe, expect, it, vi } from 'vitest';
import { loadSalesOrderReadiness } from '../stockAllocation/readinessService';

describe('stock allocation readiness service', () => {
  it('returns the target order entitlement after reserving competing protected stock', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT location_id, so_type')) return [[{ location_id: 4, so_type: 'b2b' }]];
      if (sql.includes('SELECT id, variant_id')) return [[{ id: 21, variant_id: 'v-1' }]];
      if (sql.includes('FROM ims_sales_order_items soi')) return [[
        { so_id: 1, so_item_id: 11, variant_id: 'v-1', location_id: 4, expected_date: '2026-10-01', created_at: '2026-09-01T00:00:00Z', qty_ordered: 4, qty_fulfilled: 0 },
        { so_id: 2, so_item_id: 21, variant_id: 'v-1', location_id: 4, expected_date: '2026-10-02', created_at: '2026-09-02T00:00:00Z', qty_ordered: 4, qty_fulfilled: 0 },
      ]];
      if (sql.includes('FROM ims_stock_allocations')) return [[
        { so_item_id: 11, qty_allocated: 4, qty_received_assigned: 4, qty_fulfilled: 0 },
      ]];
      if (sql.includes('FROM ims_stock')) return [[{ variant_id: 'v-1', location_id: 4, qty_on_hand: 5 }]];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const rows = await loadSalesOrderReadiness({ execute } as any, { businessId: 'biz-1', soId: 2, lock: true });

    expect(rows).toEqual([expect.objectContaining({
      soId: 2,
      soItemId: 21,
      priorityPosition: 2,
      quantityOnHand: 5,
      protectedReadyReservedForOthers: 4,
      priorityReadyQuantity: 1,
      readyNowQuantity: 1,
      shortfallNowQuantity: 3,
    })]);
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes('FROM ims_sales_order_items soi'))[0][0]).toContain('FOR UPDATE');
  });

  it('does not apply B2B allocation readiness to online orders', async () => {
    const execute = vi.fn(async () => [[{ location_id: 4, so_type: 'online' }]]);

    await expect(loadSalesOrderReadiness({ execute } as any, { businessId: 'biz-1', soId: 2 })).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
  });
});