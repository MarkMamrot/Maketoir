import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockImsQuery, mockImsExecute, mockLockInventoryCostState, mockTransferFifoCostLayers, mockResolveCurrentOwnership } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockLockInventoryCostState: vi.fn(),
  mockTransferFifoCostLayers: vi.fn(),
  mockResolveCurrentOwnership: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn(() => 'tenant_test') }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));
vi.mock('../costing/fifoCostingService', () => ({
  lockInventoryCostState: mockLockInventoryCostState,
  transferFifoCostLayers: mockTransferFifoCostLayers,
  createFifoCostLayer: vi.fn(),
}));
vi.mock('../consignment/ownership', async importOriginal => ({
  ...await importOriginal<typeof import('../consignment/ownership')>(),
  resolveCurrentOwnership: mockResolveCurrentOwnership,
  snapshotMovementOwnership: vi.fn(),
}));

import { BranchTransferUndoConflict, ImsBTRepo, type BTStatus, type ImsBTItem } from '../ImsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

beforeEach(() => {
  vi.clearAllMocks();
  mockImsQuery.mockResolvedValue([]);
  mockImsExecute.mockResolvedValue({ affectedRows: 0 });
  mockLockInventoryCostState.mockResolvedValue({ method: 'average_cost', epochId: null, revision: 1 });
  mockTransferFifoCostLayers.mockResolvedValue({ allocatedValue: 48, unitCost: 12, layerCount: 1 });
  mockResolveCurrentOwnership.mockResolvedValue({ supplierId: null, ownership: 'owned' });
});

function connectionFor(destinationQty: number, items = [
  { id: 8, transfer_id: 42, variant_id: 'variant-1', qty_sent: 5, qty_received: 4, unit_cost: 12 },
]) {
  const locationQty = new Map<number, number>([[1, 10], [2, destinationQty]]);
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM ims_branch_transfers') && sql.includes('FOR UPDATE')) {
      return [[{ id: 42, status: 'received', from_location_id: 1, to_location_id: 2 }]];
    }
    if (sql.includes('FROM ims_branch_transfer_items') && sql.includes('FOR UPDATE')) {
      return [items];
    }
    if (sql.includes('SELECT location_id, qty_on_hand FROM ims_stock')) return [[
      { location_id: 1, qty_on_hand: 10 },
      { location_id: 2, qty_on_hand: destinationQty },
    ]];
    if (sql.includes('SELECT COALESCE(avg_cost')) return [[{ avg_cost: 12 }]];
    if (sql.includes('SELECT DISTINCT consignment_supplier_id')) return [[{ consignment_supplier_id: null }]];
    if (sql.includes('SELECT qty_on_hand FROM ims_stock WHERE variant_id=')) {
      return [[{ qty_on_hand: locationQty.get(Number(params[1])) ?? 0 }]];
    }
    if (sql.includes("'transfer_out'")) return [{ affectedRows: 1, insertId: 101 }];
    if (sql.includes("'transfer_in'")) return [{ affectedRows: 1, insertId: 102 }];
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('ImsBTRepo.get', () => {
  it('loads zone and bin from the transfer source location with legacy fallback', async () => {
    mockImsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT bt.*')) return [{ id: 42, business_id: 'biz-1', from_location_id: 1 }];
      return [];
    });

    await ImsBTRepo.get(42, 'biz-1');

    const itemSql = String(mockImsQuery.mock.calls.find(([sql]) => String(sql).includes('FROM ims_branch_transfer_items bti'))?.[0]);
    expect(itemSql).toContain('LEFT JOIN ims_stock src');
    expect(itemSql).toContain('src.location_id = bt.from_location_id');
    expect(itemSql).toContain("COALESCE(NULLIF(TRIM(src.zone), ''), NULLIF(TRIM(p.zone), '')) AS zone");
    expect(itemSql).toContain("COALESCE(NULLIF(TRIM(src.bin), ''), NULLIF(TRIM(p.bin), '')) AS bin");
  });
});

describe('ImsBTRepo.undoReceipt', () => {
  it('reverses destination receipt stock and reopens the transfer as sent', async () => {
    const connection = connectionFor(9);

    await ImsBTRepo.undoReceipt(42, 'biz-1');

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET qty_received = NULL, line_value = qty_sent * unit_cost"),
      [42],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'sent', received_date = NULL"),
      [42, 42, 'biz-1'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'variant-1', 1, 5],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_shopify_inventory_queue'),
      ['biz-1', 'variant-1'],
    );
  });

  it('rolls back when destination stock cannot cover the reversal', async () => {
    const connection = connectionFor(3);

    await expect(ImsBTRepo.undoReceipt(42, 'biz-1')).rejects.toThrow(BranchTransferUndoConflict);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'sent'"),
      expect.anything(),
    );
  });

  it('checks the combined received quantity for duplicate variant lines', async () => {
    const connection = connectionFor(5, [
      { id: 8, transfer_id: 42, variant_id: 'variant-1', qty_sent: 3, qty_received: 3, unit_cost: 12 },
      { id: 9, transfer_id: 42, variant_id: 'variant-1', qty_sent: 3, qty_received: 3, unit_cost: 12 },
    ]);

    await expect(ImsBTRepo.undoReceipt(42, 'biz-1')).rejects.toThrow(/6 received units/);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('moves FIFO lineage back to the source when receipt is undone', async () => {
    mockLockInventoryCostState.mockResolvedValue({ method: 'fifo', epochId: 6, revision: 2 });
    const connection = connectionFor(9);

    await ImsBTRepo.undoReceipt(42, 'biz-1');

    expect(mockTransferFifoCostLayers).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 6, revision: 2 },
      variantId: 'variant-1',
      sourceLocationId: 2,
      destinationLocationId: 1,
      outboundMovementId: 101,
      inboundMovementId: 102,
      transferId: 42,
      transferItemId: 8,
      quantity: 4,
    });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('blocks transfer reversal after its original stock ownership changed', async () => {
    const connection = connectionFor(9);
    mockResolveCurrentOwnership.mockResolvedValue({ supplierId: 2, ownership: 'consignment' });
    await expect(ImsBTRepo.undoReceipt(42, 'biz-1')).rejects.toThrow(/ownership changed/);
    expect(mockResolveCurrentOwnership).toHaveBeenCalledWith(connection, 'biz-1', 'variant-1');
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT consignment_supplier_id'),
      ['biz-1', 42, 'variant-1', 1],
    );
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_stock_movements'))).toBe(false);
  });
});

describe('ImsBTRepo.update', () => {
  it('rebalances commitments when editing a sent transfer', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, from_location_id')) {
        return [[{ status: 'sent', from_location_id: 1 }]];
      }
      if (sql.includes('SELECT variant_id, qty_sent')) {
        return [[{ variant_id: 'old-variant', qty_sent: 4 }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsBTRepo.update(42, { from_location_id: 3 }, [
      { variant_id: 'new-variant', qty_sent: 6, unit_cost: 10 },
    ], 'biz-1');

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [4, 'old-variant', 1, 'biz-1'],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'new-variant', 3, 6],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_shopify_inventory_queue'),
      ['biz-1', 'new-variant', 'old-variant'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects edits after receipt has started', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, from_location_id')) {
        return [[{ status: 'partial', from_location_id: 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsBTRepo.update(42, { notes: 'changed' }, undefined, 'biz-1'))
      .rejects.toThrow('Only draft or sent branch transfers can be edited.');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

const reservationItems: ImsBTItem[] = [
  { id: 8, transfer_id: 42, variant_id: 'variant-1', qty_sent: 3, qty_received: 0, unit_cost: 12, line_value: 36 },
];

function reservationConnection(status: BTStatus, items = reservationItems, queueError?: Error) {
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes('INSERT INTO ims_shopify_inventory_queue') && queueError) throw queueError;
    if (sql.includes('SELECT status, from_location_id')) return [[{ status, from_location_id: 1 }]];
    if (sql.includes('SELECT * FROM ims_branch_transfers')) {
      return [[{ id: 42, status, from_location_id: 1, to_location_id: 2 }]];
    }
    if (sql.includes('FROM ims_branch_transfer_items')) {
      if (sql.trimStart().startsWith('SELECT *') && sql.includes('WHERE id = ?')) return [[items[0]]];
      if (sql.trimStart().startsWith('SELECT')) return [items];
    }
    return [{ affectedRows: 1, insertId: 42 }];
  });
  const connection = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

function expectQueued(connection: ReturnType<typeof reservationConnection>, ids = ['variant-1']) {
  const queueCalls = connection.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO ims_shopify_inventory_queue'));
  expect(queueCalls).toHaveLength(1);
  expect(connection.execute).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO ims_shopify_inventory_queue'),
    ['biz-1', ...ids],
  );
  expect(queueCalls[0][0]).toContain('WHERE business_id = ? AND variant_id IN');
  expect(queueCalls[0][0]).toContain('ON DUPLICATE KEY UPDATE queued_at = CURRENT_TIMESTAMP');
  const queueIndex = connection.execute.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO ims_shopify_inventory_queue'));
  expect(connection.execute.mock.invocationCallOrder[queueIndex]).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  expect(connection.commit).toHaveBeenCalledOnce();
  expect(connection.rollback).not.toHaveBeenCalled();
}

describe('branch transfer reservation inventory queue', () => {
  it('queues an immediately sent POS transfer in the same transaction', async () => {
    const connection = reservationConnection('sent');
    await expect(ImsBTRepo.createSent(
      { from_location_id: 1, to_location_id: 2, transfer_date: '2026-10-16' },
      reservationItems, 'biz-1',
    )).resolves.toBe(42);
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'variant-1', 1, 3],
    );
  });

  it('queues a draft being sent without needing a physical stock movement', async () => {
    const connection = reservationConnection('draft');
    await ImsBTRepo.changeStatus(42, 'sent', undefined, 'biz-1');
    expectQueued(connection);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_stock_movements'))).toBe(false);
  });

  it('deduplicates variants across repeated transfer lines', async () => {
    const connection = reservationConnection('draft', [
      ...reservationItems, { ...reservationItems[0], id: 9 },
    ]);
    await ImsBTRepo.changeStatus(42, 'sent', undefined, 'biz-1');
    expectQueued(connection);
  });

  it('queues a cancellation that releases source commitments', async () => {
    const connection = reservationConnection('sent');
    await ImsBTRepo.changeStatus(42, 'cancelled', undefined, 'biz-1');
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [3, 'variant-1', 1, 'biz-1'],
    );
  });

  it('queues released commitments even when a receipt has zero physical arrivals', async () => {
    const connection = reservationConnection('sent');
    await ImsBTRepo.changeStatus(42, 'received', [{ item_id: 8, qty_received: 0 }], 'biz-1');
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET status = ?'),
      ['partial', 42, 'biz-1'],
    );
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_stock_movements'))).toBe(false);
  });

  it('queues an empty line replacement so removed variants are refreshed', async () => {
    const connection = reservationConnection('sent');
    await ImsBTRepo.update(42, {}, [], 'biz-1');
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [3, 'variant-1', 1, 'biz-1'],
    );
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_stock (business_id'))).toBe(false);
  });

  it('moves and queues existing reservations when only the source location changes', async () => {
    const connection = reservationConnection('sent');
    await ImsBTRepo.update(42, { from_location_id: 3 }, undefined, 'biz-1');
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [3, 'variant-1', 1, 'biz-1'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'variant-1', 3, 3],
    );
  });

  it('queues removal of a sent line even though no stock was received', async () => {
    const connection = reservationConnection('sent');
    await ImsBTRepo.removeItem(42, 8, 'biz-1');
    expectQueued(connection);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_branch_transfer_items'),
      [8],
    );
  });

  it('queues commitments restored by undoing a zero-arrival receipt', async () => {
    const connection = reservationConnection('partial');
    await ImsBTRepo.undoReceipt(42, 'biz-1');
    expectQueued(connection);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_stock_movements'))).toBe(false);
  });

  it.each([
    ['draft cancellation', async () => ImsBTRepo.changeStatus(42, 'cancelled', undefined, 'biz-1'), 'draft'],
    ['repeated send', async () => ImsBTRepo.changeStatus(42, 'sent', undefined, 'biz-1'), 'sent'],
    ['sent notes edit', async () => ImsBTRepo.update(42, { notes: 'Packing note' }, undefined, 'biz-1'), 'sent'],
    ['sent destination edit', async () => ImsBTRepo.update(42, { to_location_id: 3 }, undefined, 'biz-1'), 'sent'],
    ['draft line edit', async () => ImsBTRepo.update(42, {}, reservationItems, 'biz-1'), 'draft'],
    ['draft line removal', async () => ImsBTRepo.removeItem(42, 8, 'biz-1'), 'draft'],
  ] as const)('does not queue unchanged availability for %s', async (_label, operation, status) => {
    const connection = reservationConnection(status);
    await operation();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_shopify_inventory_queue'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it.each([
    ['immediate send', async () => ImsBTRepo.createSent(
      { from_location_id: 1, to_location_id: 2, transfer_date: '2026-10-16' }, reservationItems, 'biz-1',
    ), 'sent'],
    ['send', async () => ImsBTRepo.changeStatus(42, 'sent', undefined, 'biz-1'), 'draft'],
    ['cancel', async () => ImsBTRepo.changeStatus(42, 'cancelled', undefined, 'biz-1'), 'sent'],
    ['edit', async () => ImsBTRepo.update(42, {}, reservationItems, 'biz-1'), 'sent'],
    ['remove line', async () => ImsBTRepo.removeItem(42, 8, 'biz-1'), 'sent'],
    ['undo receipt', async () => ImsBTRepo.undoReceipt(42, 'biz-1'), 'partial'],
  ] as const)('rolls back %s and reports the failure if queuing fails', async (_label, operation, status) => {
    const error = new Error('Inventory queue unavailable');
    const connection = reservationConnection(status, reservationItems, error);
    await expect(operation()).rejects.toBe(error);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      source: 'ims_branch_transfers',
      operation: 'queue_shopify_inventory',
      error,
      reference: { type: 'branch_transfer', id: 42 },
    }));
  });
});