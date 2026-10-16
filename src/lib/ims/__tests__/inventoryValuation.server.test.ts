import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), pool: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool }));
import { loadHistoricalValuation } from '../inventoryValuation.server';

const filters = { brand: 'Acme', supplierId: '7', productType: 'Tee', productId: 'v1' };
describe('historical valuation database snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pool.mockReturnValue({ getConnection: async () => ({
      query: mocks.query, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release,
    }) });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_product_variants') && sql.includes('LIMIT 1000')) {
        const prior = mocks.query.mock.calls.filter(([query]) => String(query).includes('LIMIT 1000')).length;
        return [prior === 1 ? [{
          variant_id: 'v1', sku: 'SKU', name: 'Product', brand: 'Acme', supplier_name: 'Supplier',
          created_at: '2024-01-01 00:00:00', current_cost: '7',
        }] : []];
      }
      if (sql.includes('FROM ims_stock\n')) return [[{ variant_id: 'v1', location_id: 1, qty_on_hand: '3' }]];
      return [[]];
    });
  });
  it('uses a read-only consistent snapshot, bounded tenant-filtered catalogue batches and releases it', async () => {
    const result = await loadHistoricalValuation('tenant-1', '2026-10-01 13:00:00.000', filters);
    expect(result.data[0]).toMatchObject({ cost: 7, soh: 3, total_value: 21, cost_source: 'current_fallback', inferred_opening: true });
    expect(mocks.query.mock.calls[1][0]).toBe('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const catalogue = mocks.query.mock.calls.find(([sql]) => String(sql).includes('LIMIT 1000'))!;
    expect(catalogue[1]).toEqual(['2026-10-01 13:00:00.000', 'tenant-1', '', 'v1', 'Acme', 7, 'Tee']);
    expect(catalogue[0]).not.toContain('is_active');
    const movements = mocks.query.mock.calls.find(([sql]) => String(sql).includes('FROM ims_stock_movements'))!;
    expect(movements[1]).toEqual(['tenant-1', 'tenant-1', 'v1']);
    expect(movements[0]).not.toContain('INTERVAL 1 YEAR');
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rolls back and releases the snapshot on failure rather than returning an empty success', async () => {
    mocks.query.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(loadHistoricalValuation('tenant-1', '2026-10-01 13:00:00.000', filters)).rejects.toThrow('DB unavailable');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('classifies ownership from dated product history rather than the current supplier flag', async () => {
    const result = await loadHistoricalValuation('tenant-1', '2026-10-01 13:00:00.000', { ...filters, ownership: 'consignment' });
    const catalogue = mocks.query.mock.calls.find(([sql]) => String(sql).includes('LIMIT 1000'))!;
    expect(catalogue[0]).toContain('history.effective_at < ?');
    expect(catalogue[0]).toContain('history.business_id = p.business_id');
    expect(catalogue[0]).toContain('COALESCE(ownership_history.is_consignment, 0) = 1');
    expect(catalogue[0]).not.toContain('c.is_consignment');
    expect(result.data[0].cost).toBe(7);
  });
  it('uses closed historical FIFO epochs, dated allocations and current active layers for fallback costs', async () => {
    const defaultQuery = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM ims_inventory_cost_epochs')) return [[
        { id: 1, method: 'fifo', started_at: '2026-09-01 00:00:00.000' },
        { id: 2, method: 'fifo', started_at: '2026-10-10 00:00:00.000' },
      ]];
      if (sql.includes('FROM ims_inventory_cost_state')) return [[{ active_method: 'fifo', active_epoch_id: 2 }]];
      if (sql.includes('SUM(remaining_quantity)')) {
        expect(values).toEqual(['tenant-1', 2, 'v1']);
        return [[{ variant_id: 'v1', quantity: '3', value: '30' }]];
      }
      if (sql.includes('SELECT id, variant_id, location_id, original_quantity')) {
        expect(values).toEqual(['tenant-1', 1, 'v1', '2026-10-01 13:00:00.000']);
        return [[{ id: 11, variant_id: 'v1', location_id: 1, original_quantity: '5', unit_cost: '4', created_at: '2026-09-01 00:00:00.000' }]];
      }
      if (sql.includes('FROM ims_fifo_cost_allocations')) {
        expect(values).toEqual(['tenant-1', 1, 'v1', '2026-10-01 13:00:00.000']);
        return [[{ layer_id: 11, quantity: '3', allocation_type: 'consume', created_at: '2026-09-02 00:00:00.000' }]];
      }
      return defaultQuery(sql, values);
    });
    const result = await loadHistoricalValuation('tenant-1', '2026-10-01 13:00:00.000', filters);
    expect(result).toMatchObject({
      costing_method: 'fifo', cost_epoch_id: 1,
      data: [{ soh: 3, layer_quantity: 2, cost: 10, total_value: 30, cost_source: 'current_fallback' }],
      reconciliation: { status: 'mismatch' },
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('fails visibly if active FIFO history is missing', async () => {
    const defaultQuery = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => sql.includes('FROM ims_inventory_cost_state')
      ? [[{ active_method: 'fifo', active_epoch_id: 2 }]] : defaultQuery(sql, values));
    await expect(loadHistoricalValuation('tenant-1', '2026-10-01 13:00:00.000', filters)).rejects.toThrow('missing from recorded costing history');
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
});
