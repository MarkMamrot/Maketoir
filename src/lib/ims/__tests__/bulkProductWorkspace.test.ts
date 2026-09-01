import { describe, expect, it } from 'vitest';
import { buildBulkProductListPlan, sanitizeBulkProductWorkspace } from '../bulkProductWorkspace';

describe('bulk product workspace', () => {
  it('requires ALL stock filters to match one variant and branch stock row', () => {
    const plan = buildBulkProductListPlan({
      filterJoin: 'and',
      sortKey: 'inventory',
      sortDirection: 'desc',
      filters: [
        { id: 'zone', field: 'zone', operator: 'contains', value: 'A' },
        { id: 'min', field: 'min_qty', operator: '>=', value: '4' },
      ],
    });

    expect(plan.filterSql.match(/FROM ims_product_variants bv/g)).toHaveLength(1);
    expect(plan.filterSql).toContain("COALESCE(bs.zone, '') LIKE ?");
    expect(plan.filterSql).toContain('bs.min_qty >= ?');
    expect(plan.filterSql).toContain('bl.is_active = 1');
    expect(plan.filterSql).toContain('bv.is_active = 1');
    expect(plan.filterParams).toEqual(['%A%', 4]);
    expect(plan.orderBySql).toContain('SUM(ss.qty_on_hand)');
    expect(plan.orderBySql).toContain('sl.is_active = 1');
    expect(plan.orderBySql).toContain('sv.is_active = 1');
    expect(plan.orderBySql).toContain('DESC');
  });

  it('allows ANY filters to be satisfied independently', () => {
    const plan = buildBulkProductListPlan({
      filterJoin: 'or',
      sortKey: 'rrp',
      sortDirection: 'asc',
      filters: [
        { id: 'zone', field: 'zone', operator: '=', value: 'A1' },
        { id: 'cost', field: 'cost', operator: '<', value: '25' },
      ],
    });

    expect(plan.filterSql).toContain(' OR ');
    expect(plan.filterParams).toEqual(['A1', 25]);
    expect(plan.orderBySql).toContain('MIN(NULLIF(sv.price_rrp, 0))');
  });

  it('sanitizes persisted workspace values and rejects untrusted operators', () => {
    const workspace = sanitizeBulkProductWorkspace({
      selectedFields: ['name', 4, 'brand'], sortKey: 'cost', sortDirection: 'DROP TABLE', filterJoin: 'or',
      filters: [
        { id: 'valid', field: 'rrp', operator: '>=', value: '10.5' },
        { id: 'invalid', field: 'cost', operator: 'OR 1=1', value: '0' },
      ],
    });

    expect(workspace.selectedFields).toEqual(['name', 'brand']);
    expect(workspace.sortDirection).toBe('asc');
    expect(workspace.filters).toEqual([{ id: 'valid', field: 'rrp', operator: '>=', value: '10.5' }]);
  });

  it('falls back from inherited or unknown sort keys', () => {
    const plan = buildBulkProductListPlan({ filters: [], filterJoin: 'and', sortKey: 'toString' as any, sortDirection: 'desc' });
    expect(plan.orderBySql).toBe('p.name DESC, p.name ASC, p.product_id ASC');
  });

  it('sorts a branch replenishment heading with a validated location id', () => {
    const plan = buildBulkProductListPlan({ filters: [], filterJoin: 'and', sortKey: 'location_7_reorder_qty', sortDirection: 'desc' });

    expect(plan.orderBySql).toContain('MIN(bs.reorder_qty)');
    expect(plan.orderBySql).toContain('bs.location_id = 7');
    expect(plan.orderBySql).toContain('bl.is_active = 1');
    expect(plan.orderBySql).toContain('DESC');
  });

  it('retains safe header sort keys in persisted workspaces', () => {
    expect(sanitizeBulkProductWorkspace({ sortKey: 'base_sku' }).sortKey).toBe('base_sku');
    expect(sanitizeBulkProductWorkspace({ sortKey: 'location_12_min_qty' }).sortKey).toBe('location_12_min_qty');
    expect(sanitizeBulkProductWorkspace({ sortKey: 'location_12_min_qty DESC' }).sortKey).toBe('name');
  });

  it('sorts only whitelisted foreign-currency cost headings', () => {
    const plan = buildBulkProductListPlan({ filters: [], filterJoin: 'and', sortKey: 'foreign_cost_USD', sortDirection: 'asc' });

    expect(plan.orderBySql).toContain("JSON_EXTRACT(sv.cost_foreign, '$.USD')");
    expect(sanitizeBulkProductWorkspace({ sortKey: 'foreign_cost_AUD' }).sortKey).toBe('name');
  });
});