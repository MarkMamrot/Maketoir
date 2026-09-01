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
    expect(plan.filterParams).toEqual(['%A%', 4]);
    expect(plan.orderBySql).toContain('SUM(ss.qty_on_hand)');
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
});