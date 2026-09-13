import { describe, expect, it, vi } from 'vitest';

import { auditFifoTenant } from '../../../../../scripts/lib/fifo-integrity-audit.mjs';

describe('FIFO tenant integrity audit', () => {
  it('reports a balanced tenant without issuing writes', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([[{
        id: 1,
        active_method: 'fifo',
        active_epoch_id: 4,
        epoch_business_id: 'biz-1',
        epoch_method: 'fifo',
        epoch_status: 'active',
        active_epoch_count: 1,
      }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ column_count: 1 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    await expect(auditFifoTenant({ query } as any, {
      schema: 'tenant_one',
      businessId: 'biz-1',
    })).resolves.toEqual({ schema: 'tenant_one', status: 'balanced', findings: [] });

    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls[1][0]).toContain('BINARY stock.variant_id AS variant_id');
    expect(query.mock.calls[1][0]).toContain('BINARY layer.variant_id AS variant_id');
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).toMatch(/^SELECT/i);
      expect(String(sql)).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
    }
  });

  it('does not compare Average Cost stock with inactive historical FIFO layers', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([[{
        id: 1,
        active_method: 'average_cost',
        active_epoch_id: null,
        epoch_business_id: null,
        epoch_method: null,
        epoch_status: null,
        active_epoch_count: 0,
      }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ column_count: 1 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    await expect(auditFifoTenant({ query } as any, {
      schema: 'tenant_one',
      businessId: 'biz-1',
    })).resolves.toMatchObject({ status: 'balanced', findings: [] });
    expect(query.mock.calls[1][0]).toContain("state.active_method = 'fifo'");
  });

  it('reports state, location, layer, allocation, and movement discrepancies without business data', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([[{
        id: 1,
        active_method: 'fifo',
        active_epoch_id: 4,
        epoch_business_id: 'other-business',
        epoch_method: 'fifo',
        epoch_status: 'closed',
        active_epoch_count: 2,
      }]])
      .mockResolvedValueOnce([[{ location_id: 7, mismatch_count: 2 }]])
      .mockResolvedValueOnce([[{ id: 31 }]])
      .mockResolvedValueOnce([[{ column_count: 1 }]])
      .mockResolvedValueOnce([[{ id: 36 }]])
      .mockResolvedValueOnce([[{ id: 41 }]])
      .mockResolvedValueOnce([[{ id: 51 }]]);

    const result = await auditFifoTenant({ query } as any, {
      schema: 'tenant_one',
      businessId: 'biz-secret',
    });

    expect(result).toEqual({
      schema: 'tenant_one',
      status: 'mismatch',
      findings: [
        { code: 'invalid_costing_state', count: 1, sampleIds: [1] },
        { code: 'stock_layer_location_mismatch', count: 2, sampleIds: [7] },
        { code: 'invalid_layer_bounds', count: 1, sampleIds: [31] },
        { code: 'zero_cost_layer_without_reason', count: 1, sampleIds: [36] },
        { code: 'invalid_or_orphaned_allocation', count: 1, sampleIds: [41] },
        { code: 'fifo_movement_coverage_mismatch', count: 1, sampleIds: [51] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('biz-secret');
  });

  it('rejects unsafe schema identifiers before querying', async () => {
    const query = vi.fn();
    await expect(auditFifoTenant({ query } as any, {
      schema: 'tenant`; DROP DATABASE production; --',
      businessId: 'biz-1',
    })).rejects.toThrow('Invalid tenant schema name');
    expect(query).not.toHaveBeenCalled();
  });
});
