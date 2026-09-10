import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetIMSPool = vi.hoisted(() => vi.fn());
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mockGetIMSPool }));

import { switchInventoryCostMethod } from '../inventoryCostSwitch';

const baseInput = {
  businessId: 'biz-1',
  targetMethod: 'fifo' as const,
  expectedRevision: 1,
  operationKey: 'switch-fifo-1',
  reason: 'Use FIFO for future inventory movements',
  actorId: 7,
  actorName: 'Alex',
};

describe('inventory cost method switching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates one FIFO opening layer per positive stock row and preserves opening value', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT active_method')) return [[{ active_method: 'average_cost', active_epoch_id: null, revision: 1 }]];
      if (sql.includes('FROM ims_inventory_cost_epochs') && sql.includes('operation_key')) return [[]];
      if (sql.includes('FROM ims_stock s')) return [[
        { variant_id: 'v-1', location_id: 1, qty_on_hand: 2, unit_cost: 10 },
        { variant_id: 'v-1', location_id: 2, qty_on_hand: 3, unit_cost: 10 },
        { variant_id: 'v-2', location_id: 1, qty_on_hand: 0, unit_cost: 7 },
      ]];
      if (sql.includes('INSERT INTO ims_inventory_cost_epochs')) return [{ insertId: 44 }];
      if (sql.includes('INSERT INTO ims_fifo_cost_layers')) return [{ insertId: 70 }];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    const result = await switchInventoryCostMethod(baseInput);

    expect(result).toMatchObject({ epochId: 44, replayed: false, preview: { totalQuantity: 5, totalValue: 50, blockers: [] } });
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO ims_fifo_cost_layers'))).toHaveLength(2);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_inventory_cost_state'), [
      'fifo', 44, 7, baseInput.reason, 'biz-1', 1,
    ]);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('blocks FIFO activation before creating an epoch when positive stock has no cost', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT active_method')) return [[{ active_method: 'average_cost', active_epoch_id: null, revision: 1 }]];
      if (sql.includes('FROM ims_inventory_cost_epochs') && sql.includes('operation_key')) return [[]];
      if (sql.includes('FROM ims_stock s')) return [[{ variant_id: 'v-1', location_id: 1, qty_on_hand: 2, unit_cost: null }]];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(switchInventoryCostMethod(baseInput)).rejects.toThrow('no valid positive average cost');

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_inventory_cost_epochs'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('reconciles FIFO layers and derives organisation-wide average cost when switching back', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT active_method')) return [[{ active_method: 'fifo', active_epoch_id: 40, revision: 2 }]];
      if (sql.includes('FROM ims_inventory_cost_epochs') && sql.includes('operation_key')) return [[]];
      if (sql.includes('FROM ims_stock s')) return [[
        { variant_id: 'v-1', location_id: 1, qty_on_hand: 2, unit_cost: 99 },
        { variant_id: 'v-1', location_id: 2, qty_on_hand: 3, unit_cost: 99 },
      ]];
      if (sql.includes('FROM ims_fifo_cost_layers')) return [[
        { variant_id: 'v-1', location_id: 1, remaining_quantity: 2, unit_cost: 10 },
        { variant_id: 'v-1', location_id: 2, remaining_quantity: 3, unit_cost: 20 },
      ]];
      if (sql.includes('INSERT INTO ims_inventory_cost_epochs')) return [{ insertId: 45 }];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    const result = await switchInventoryCostMethod({
      ...baseInput,
      targetMethod: 'average_cost',
      expectedRevision: 2,
      operationKey: 'switch-average-1',
    });

    expect(result.preview.totalValue).toBe(80);
    expect(execute).toHaveBeenCalledWith('UPDATE ims_product_variants SET avg_cost = ? WHERE variant_id = ?', [16, 'v-1']);
    expect(execute).toHaveBeenCalledWith('UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?', [16, 'v-1']);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects a stale preview revision before any epoch or layer changes', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT active_method')) return [[{ active_method: 'average_cost', active_epoch_id: null, revision: 2 }]];
      if (sql.includes('FROM ims_inventory_cost_epochs') && sql.includes('operation_key')) return [[]];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(switchInventoryCostMethod(baseInput)).rejects.toThrow('changed after this preview');
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_inventory_cost_epochs'))).toBe(false);
  });
});