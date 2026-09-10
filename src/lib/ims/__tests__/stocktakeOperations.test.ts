import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool } = vi.hoisted(() => ({ mockGetIMSPool: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mockGetIMSPool }));

import { applyStocktake, revertStocktake, transitionStocktake } from '../stocktakes/stocktakeOperations';

const context = {
  operationKey: 'stable-key', requestHash: 'request-hash', expectedUpdatedAt: '2026-08-12T09:00:00.000Z', actorId: 7, actorName: 'Alex',
};

function connectionFor(mode: 'apply' | 'revert' | 'start', options: {
  operationState?: 'complete' | 'processing';
  currentOnHand?: number;
  updatedAt?: string;
  xeroJournalId?: string | null;
  xeroStatus?: string | null;
  costingMethod?: 'average_cost' | 'fifo';
  countedQuantity?: number;
} = {}) {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from ims_stocktakes') && normalized.includes('for update')) {
      return [[{
        id: 31,
        business_id: 'biz-1',
        location_id: 4,
        status: mode === 'apply' ? 'in_progress' : mode === 'start' ? 'draft' : 'completed',
        updated_at: options.updatedAt ?? '2026-08-12T09:00:00.000Z',
        xero_journal_id: options.xeroJournalId ?? null,
        xero_sync_status: options.xeroStatus ?? null,
      }]];
    }
    if (normalized.includes('from ims_inventory_document_operations') && normalized.includes('for update')) {
      return [options.operationState ? [{
        id: 81,
        request_hash: 'request-hash',
        document_kind: 'stocktake',
        document_id: 31,
        action: mode === 'apply' ? 'complete' : mode === 'start' ? 'start' : 'revert_mistaken_completion',
        state: options.operationState,
        response_json: JSON.stringify(mode === 'apply'
          ? { id: 31, status: 'completed', applied: 1, variances: 1, countStartVariances: 1, replayed: false }
          : { id: 31, status: 'reverted', reverted: 1, replayed: false, xeroReversalStatus: 'not_required' }),
      }] : []];
    }
    if (normalized.startsWith('insert into ims_inventory_document_operations')) return [{ insertId: 81, affectedRows: 1 }];
    if (normalized.includes('select active_method, active_epoch_id, revision')) {
      return [[{
        active_method: options.costingMethod ?? 'average_cost',
        active_epoch_id: options.costingMethod === 'fifo' ? 12 : null,
        revision: 1,
      }]];
    }
    if (normalized.includes('from ims_stocktake_items') && normalized.includes('for update')) {
      return [[{
        id: 41,
        variant_id: 'v-1',
        expected_qty: 10,
        counted_qty: options.countedQuantity ?? 6,
        soh_at_apply: mode === 'revert' ? 8 : null,
        applied_delta: mode === 'revert' ? -2 : null,
        unit_cost_at_apply: mode === 'revert' ? 5.5 : null,
      }]];
    }
    if (normalized.includes('select qty_on_hand from ims_stock')) {
      return [[{ qty_on_hand: options.currentOnHand ?? (mode === 'apply' ? 8 : 9) }]];
    }
    if (normalized.includes('from ims_product_variants')) return [[{ unit_cost: 5.5 }]];
    if (normalized.startsWith('insert into ims_stock_movements')) return [{ insertId: 91, affectedRows: 1 }];
    if (normalized.includes('from ims_fifo_cost_layers')) {
      return [[{ id: 51, fifo_date: '2026-01-01', remaining_quantity: 8, unit_cost: 4.25 }]];
    }
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('stocktake operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies counted quantity against locked current SOH and persists the exact snapshot', async () => {
    const connection = connectionFor('apply');

    const result = await applyStocktake({ businessId: 'biz-1', stocktakeId: 31, context });

    expect(result).toMatchObject({ status: 'completed', applied: 1, variances: 1, countStartVariances: 1 });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, ?, 'stocktake'"),
      ['biz-1', 'v-1', 4, 31, -2, 6, 5.5, 'average_cost', null],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET soh_at_apply = ?, applied_delta = ?, unit_cost_at_apply = ?'),
      [8, -2, 5.5, 41, 31],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('consumes FIFO layers for a negative stocktake variance and stamps actual cost', async () => {
    const connection = connectionFor('apply', { costingMethod: 'fifo' });

    await applyStocktake({ businessId: 'biz-1', stocktakeId: 31, context });

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET remaining_quantity = remaining_quantity - ?'),
      [2, 51, 'biz-1', 12, 2],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_fifo_cost_allocations'),
      ['biz-1', 12, 91, 51, 2, 4.25, 8.5],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET unit_cost = ?, cost_method_snapshot = 'fifo'"),
      [4.25, 12, 91, 'biz-1'],
    );
  });

  it('creates a FIFO layer for a positive stocktake variance at the captured cost', async () => {
    const connection = connectionFor('apply', { costingMethod: 'fifo', currentOnHand: 4, countedQuantity: 6 });

    await applyStocktake({ businessId: 'biz-1', stocktakeId: 31, context });

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_fifo_cost_layers'),
      ['biz-1', 12, 'v-1', 4, 'stocktake', 91, 'stocktake', 31, 41, null,
        expect.any(Date), 2, 2, 5.5],
    );
  });

  it('reverts by compensating exact applied delta after an intervening stock movement', async () => {
    const connection = connectionFor('revert', { currentOnHand: 9 });

    const result = await revertStocktake({
      businessId: 'biz-1', stocktakeId: 31, reason: 'Count entered in error', context,
    });

    expect(result).toMatchObject({ status: 'reverted', reverted: 1, xeroReversalStatus: 'not_required' });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_stock SET qty_on_hand = ?'),
      [11, 'biz-1', 'v-1', 4],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'stocktake_reverted'"),
      ['biz-1', 'v-1', 4, 31, 2, 11, 5.5, 'Count entered in error'],
    );
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ims_stock_movements'), expect.anything());
  });

  it('replays apply before item or stock mutation', async () => {
    const connection = connectionFor('apply', { operationState: 'complete' });

    const result = await applyStocktake({ businessId: 'biz-1', stocktakeId: 31, context });

    expect(result).toMatchObject({ status: 'completed', replayed: true });
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('FROM ims_stocktake_items'), expect.anything());
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back a stale apply before item or stock mutation', async () => {
    const connection = connectionFor('apply');

    await expect(applyStocktake({
      businessId: 'biz-1', stocktakeId: 31, context: { ...context, expectedUpdatedAt: 'old-revision' },
    })).rejects.toThrow('This document changed after you opened it');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('FROM ims_stocktake_items'), expect.anything());
  });

  it('queues a reversing journal only when the original journal is confirmed synced', async () => {
    const queued = connectionFor('revert', { xeroJournalId: 'journal-1', xeroStatus: 'synced' });
    const result = await revertStocktake({ businessId: 'biz-1', stocktakeId: 31, reason: 'Mistake', context });
    expect(result.xeroReversalStatus).toBe('queued');
    expect(queued.commit).toHaveBeenCalledOnce();
  });

  it('blocks automatic Xero correction when an original posting attempt has an unknown outcome', async () => {
    connectionFor('revert', { xeroJournalId: null, xeroStatus: 'error' });

    const result = await revertStocktake({ businessId: 'biz-1', stocktakeId: 31, reason: 'Mistake', context });

    expect(result.xeroReversalStatus).toBe('blocked');
  });

  it('records Start through the operation ledger without touching stock', async () => {
    const connection = connectionFor('start');

    const result = await transitionStocktake({
      businessId: 'biz-1', stocktakeId: 31, action: 'start', context,
    });

    expect(result).toEqual({ id: 31, status: 'in_progress', replayed: false });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_stocktakes SET status = ?'),
      ['in_progress', 31, 'biz-1'],
    );
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_stock SET'), expect.anything());
  });

  it('blocks automatic reversal when a legacy counted line has no apply snapshot', async () => {
    const connection = connectionFor('revert');
    connection.execute.mockImplementationOnce(connection.execute.getMockImplementation()!);
    const originalImplementation = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.replace(/\s+/g, ' ').toLowerCase().includes('from ims_stocktake_items')) {
        return [[{ id: 41, variant_id: 'v-1', expected_qty: 10, counted_qty: 6, soh_at_apply: null, applied_delta: null, unit_cost_at_apply: null }]] as any;
      }
      return originalImplementation(sql, params);
    });

    await expect(revertStocktake({ businessId: 'biz-1', stocktakeId: 31, reason: 'Mistake', context }))
      .rejects.toThrow('predates exact apply snapshots');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_stock SET'), expect.anything());
  });

  it('blocks FIFO reversal before reading items or mutating stock', async () => {
    const connection = connectionFor('revert', { costingMethod: 'fifo' });

    await expect(revertStocktake({ businessId: 'biz-1', stocktakeId: 31, reason: 'Mistake', context }))
      .rejects.toThrow('exact cost-layer allocations must be preserved');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('FROM ims_stocktake_items'), expect.anything());
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_stock SET'), expect.anything());
  });
});
