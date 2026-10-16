import { describe, expect, it, vi } from 'vitest';
import { assertConsignmentDocument, assertConsignmentProductSupported, assertProductOwnershipChangeSafe, changeSupplierOwnership, resolveHistoricalOwnership } from '../ownership';

vi.mock('../../costing/fifoCostingService', () => ({ lockInventoryCostState: vi.fn() }));

describe('consignment ownership', () => {
  it.each([{ uses_builds: 1 }, { is_stock_item: 0 }, { product_type: 'assembly' }])('rejects unsupported products %j', product => {
    expect(() => assertConsignmentProductSupported(product)).toThrow(/stock products only/);
  });
  it('does not classify historical stock using the current supplier', async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    await expect(resolveHistoricalOwnership({ execute } as any, 'biz', 'uuid', '2026-01-01')).resolves.toEqual({ ownership: 'owned', supplierId: null });
    expect(execute.mock.calls[0][0]).toContain('effective_at <= ?');
    expect(execute.mock.calls[0][0]).not.toContain('ims_contacts');
  });
  it('checks every branch and inactive variant without netting positions', async () => {
    const execute = vi.fn().mockResolvedValue([[{ reason: 'stock or commitments' }]]);
    await expect(assertProductOwnershipChangeSafe({ execute } as any, 'biz', 'uuid')).rejects.toThrow(/every branch/);
    const sql = execute.mock.calls[0][0];
    expect(sql).toContain('s.qty_on_hand <> 0');
    expect(sql).toContain('s.qty_incoming <> 0');
    expect(sql).toContain('s.qty_committed <> 0');
    expect(sql).not.toContain('is_active');
    expect(sql).not.toContain('SUM(s.qty_on_hand');
    expect(sql).toContain('ti.disabled_at IS NULL');
    expect(sql).toContain("'Draft','Finalised'");
  });
  it('requires an administrator before changing ownership', async () => {
    const execute = vi.fn();
    await expect(changeSupplierOwnership({ execute } as any, 'biz', 1, true)).rejects.toThrow(/administrators/);
    expect(execute).not.toHaveBeenCalled();
  });
  it('writes an effective UTC history row for each inactive or active supplier product', async () => {
    const execute = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_contacts')) return [[{ id: 2, type: 'supplier', is_consignment: 0 }]];
      if (sql.includes('SELECT * FROM ims_products')) return [[{ product_id: 'active-uuid' }, { product_id: 'inactive-uuid', is_active: 0 }]];
      if (sql.startsWith('SELECT')) return [[]];
      return [{ affectedRows: 1 }];
    });
    await changeSupplierOwnership({ execute } as any, 'biz', 2, true, { isAdmin: true, actorId: 7 });
    const history = execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO ims_consignment_ownership_history'));
    expect(history).toHaveLength(2);
    expect(history.map(([, values]) => values[1])).toEqual(['active-uuid', 'inactive-uuid']);
    expect(history[0][0]).toContain('UTC_TIMESTAMP(6)');
    expect(history[0][1]).toEqual(['biz', 'active-uuid', 2, 1, 7, expect.any(String)]);
  });
  it('rejects AUD conversion and immutable owner changes', async () => {
    const execute = vi.fn().mockResolvedValue([[{ is_consignment: 1 }]]);
    await expect(assertConsignmentDocument({ execute } as any, 'biz', { supplier_id: 2, currency_code: 'USD' }, [])).rejects.toThrow(/AUD only/);
    await expect(assertConsignmentDocument({ execute } as any, 'biz', { supplier_id: 2, consignment_supplier_id: 1 }, [], true)).rejects.toThrow(/snapshot/);
  });
});
