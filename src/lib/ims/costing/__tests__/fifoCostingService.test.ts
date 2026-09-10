import { describe, expect, it, vi } from 'vitest';

import {
  consumeFifoCostLayers,
  createFifoCostLayer,
  FifoCostingConflict,
  lockInventoryCostState,
} from '../fifoCostingService';

describe('FIFO costing service', () => {
  it('creates and locks the default average-cost state for an existing tenant', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT active_method')) {
        return [[{ active_method: 'average_cost', active_epoch_id: null, revision: 1 }]];
      }
      return [{ affectedRows: 1 }];
    });

    await expect(lockInventoryCostState({ execute } as any, 'biz-1')).resolves.toEqual({
      method: 'average_cost',
      epochId: null,
      revision: 1,
    });
    expect(execute.mock.calls[0][0]).toContain('INSERT IGNORE INTO ims_inventory_cost_state');
    expect(execute.mock.calls[1][0]).toContain('FOR UPDATE');
  });

  it('creates an inbound layer only in an active FIFO epoch', async () => {
    const execute = vi.fn(async () => [{ insertId: 72 }]);
    const layerId = await createFifoCostLayer({ execute } as any, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 4, revision: 2 },
      variantId: 'v-1',
      locationId: 3,
      sourceType: 'po_receipt',
      sourceMovementId: 90,
      sourceReferenceType: 'purchase_order',
      sourceReferenceId: 12,
      sourceLineId: 13,
      fifoDate: '2026-09-10T10:00:00Z',
      quantity: 5,
      unitCost: 8.25,
    });

    expect(layerId).toBe(72);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_fifo_cost_layers'), [
      'biz-1', 4, 'v-1', 3, 'po_receipt', 90, 'purchase_order', 12, 13, null,
      expect.any(Date), 5, 5, 8.25,
    ]);
  });

  it('consumes locked layers and stamps the movement with weighted FIFO cost', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, fifo_date')) {
        return [[
          { id: 1, fifo_date: '2026-01-01', remaining_quantity: 2, unit_cost: 10 },
          { id: 2, fifo_date: '2026-02-01', remaining_quantity: 4, unit_cost: 12 },
        ]];
      }
      return [{ affectedRows: 1 }];
    });

    await expect(consumeFifoCostLayers({ execute } as any, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 4, revision: 2 },
      variantId: 'v-1',
      locationId: 3,
      stockMovementId: 99,
      quantity: 5,
    })).resolves.toEqual({ allocatedValue: 56, unitCost: 11.2, allocationCount: 2 });

    expect(execute.mock.calls.filter(([sql]) => String(sql).includes('UPDATE ims_fifo_cost_layers'))).toHaveLength(2);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("cost_method_snapshot = 'fifo'"),
      [11.2, 4, 99, 'biz-1'],
    );
  });

  it('rejects a layer shortage before writing any allocation or movement cost', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, fifo_date')) {
        return [[{ id: 1, fifo_date: '2026-01-01', remaining_quantity: 2, unit_cost: 10 }]];
      }
      return [{ affectedRows: 1 }];
    });

    const error = await consumeFifoCostLayers({ execute } as any, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 4, revision: 2 },
      variantId: 'v-1',
      locationId: 3,
      stockMovementId: 99,
      quantity: 3,
    }).catch(value => value);

    expect(error).toBeInstanceOf(FifoCostingConflict);
    expect(error.message).toContain('cover 2 units, but 3 are required');
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_fifo_cost_allocations'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_stock_movements'))).toBe(false);
  });
});