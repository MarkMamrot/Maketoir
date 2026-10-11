import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockLockInventoryCostState, mockCreateFifoPosReturnLayers, mockCreateFifoSalesOrderReturnLayers } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockLockInventoryCostState: vi.fn(),
  mockCreateFifoPosReturnLayers: vi.fn(),
  mockCreateFifoSalesOrderReturnLayers: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));
vi.mock('../costing/fifoCostingService', () => ({
  lockInventoryCostState: mockLockInventoryCostState,
  createFifoPosReturnLayers: mockCreateFifoPosReturnLayers,
  createFifoSalesOrderReturnLayers: mockCreateFifoSalesOrderReturnLayers,
  FifoCostingConflict: class FifoCostingConflict extends Error { code = 'FIFO_COSTING_CONFLICT'; status = 409; },
}));

import { ImsCNRepo, ImsSORepo } from '../ImsRepository';

function connectionFor(options: {
  operationState?: 'processing' | 'complete';
  sourceSoItemId?: number;
  fulfilledQty?: number;
  returnedQty?: number;
  posReturn?: boolean;
  restockLinkedReturn?: boolean;
  sourceUnitCost?: number | null;
} = {}) {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from ims_credit_notes') && normalized.includes('for update')) {
      return [[{
        id: 12,
        business_id: 'biz-1',
        cn_number: 'CN-00012',
        status: 'draft',
        source: options.posReturn ? 'pos' : 'shopify',
        pos_sale_id: options.posReturn ? 30 : null,
        settlement_method: options.posReturn ? 'refund' : 'external',
        location_id: 4,
        so_id: options.sourceSoItemId ? 9 : null,
        customer_id: null,
        total_amount: 10,
        cn_date: '2026-09-10',
        updated_at: '2026-08-12T09:00:00.000Z',
      }]];
    }
    if (normalized.includes('from ims_inventory_document_operations') && normalized.includes('for update')) {
      return [options.operationState ? [{
        id: 82,
        request_hash: 'request-hash',
        document_kind: 'customer_credit_note',
        document_id: 12,
        action: 'complete',
        state: options.operationState,
        response_json: JSON.stringify({ id: 12, status: 'complete' }),
      }] : []];
    }
    if (normalized.startsWith('insert into ims_inventory_document_operations')) {
      return [{ insertId: 82, affectedRows: 1 }];
    }
    if (normalized.includes('sum(cni.qty)')) {
      return [[{ returned_qty: options.returnedQty ?? 0 }]];
    }
    if (normalized.includes('from ims_credit_note_items')) {
      return [options.posReturn ? [{
        id: 31, cn_id: 12, source_so_item_id: null,
        variant_id: 'v-1', qty: 2, unit_price: 5, restock: 1,
      }] : options.sourceSoItemId ? [{
        id: 31, cn_id: 12, source_so_item_id: options.sourceSoItemId,
        variant_id: 'v-1', qty: 2, unit_price: 5, restock: options.restockLinkedReturn ? 1 : 0,
      }] : []];
    }
    if (normalized.includes('from ims_sales_order_items soi')) {
      return [[{ qty_fulfilled: options.fulfilledQty ?? 2, unit_cost: options.sourceUnitCost === undefined ? 10 : options.sourceUnitCost }]];
    }
    if (normalized.includes('select so_type from ims_sales_orders')) {
      return [[{ so_type: 'wholesale' }]];
    }
    if (normalized.includes('from ims_product_variants pv')) return [[{ is_stock_item: 1, avg_cost: 99 }]];
    if (normalized.includes('select qty_on_hand from ims_stock')) return [[{ qty_on_hand: 7 }]];
    if (normalized.includes('insert into ims_stock_movements')) return [{ affectedRows: 1, insertId: 501 }];
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('ImsCNRepo.complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLockInventoryCostState.mockResolvedValue({ method: 'average_cost', epochId: null, revision: 1 });
  });

  const operationContext = {
    operationKey: 'customer_credit_note:12:complete:revision:r1:request:request-hash',
    requestHash: 'request-hash',
    expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
    actorId: 9,
    actorName: 'Morgan',
  };

  it('replays a completed operation before settlement or stock side effects', async () => {
    const connection = connectionFor({ operationState: 'complete' });

    await expect(ImsCNRepo.complete(12, 'biz-1', operationContext)).resolves.toBeUndefined();

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_credit_note_items'),
      expect.anything(),
    );
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('store_credit_transactions'),
      expect.anything(),
    );
  });

  it('rolls back a stale revision before settlement or stock side effects', async () => {
    const connection = connectionFor();

    await expect(ImsCNRepo.complete(12, 'biz-1', {
      ...operationContext,
      expectedUpdatedAt: '2026-08-12T08:00:00.000Z',
    })).rejects.toThrow('This document changed after you opened it. Refresh and review the latest values before continuing.');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_credit_note_items'),
      expect.anything(),
    );
  });

  it('completes the operation record in the same document transaction', async () => {
    const connection = connectionFor();

    await ImsCNRepo.complete(12, 'biz-1', operationContext);

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET status = \'complete\''),
      ['external', null, 12, 'biz-1'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'complete'"),
      ['complete', JSON.stringify({ id: 12, status: 'complete' }), JSON.stringify({ status: 'complete', settlementMethod: 'external', storeCreditTransactionId: null }), 82, 'biz-1'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('blocks cumulative linked returns above the fulfilled source quantity', async () => {
    const connection = connectionFor({ sourceSoItemId: 21, fulfilledQty: 3, returnedQty: 2 });

    await expect(ImsCNRepo.complete(12, 'biz-1')).rejects.toThrow(
      'Return quantity for sales order line 21 exceeds the remaining returnable quantity of 1.',
    );

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('store_credit_transactions'),
      expect.anything(),
    );
  });

  it('restores linked POS return layers while completing the credit note', async () => {
    mockLockInventoryCostState.mockResolvedValue({ method: 'fifo', epochId: 6, revision: 2 });
    mockCreateFifoPosReturnLayers.mockResolvedValue({ allocatedValue: 20, unitCost: 10, layerCount: 1 });
    const connection = connectionFor({ posReturn: true });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(mockCreateFifoPosReturnLayers).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 6, revision: 2 },
      returnPosSaleId: 30,
      creditNoteId: 12,
      returnMovementId: 501,
      variantId: 'v-1',
      locationId: 4,
      quantity: 2,
      returnDate: '2026-09-10',
    });
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('captures the fulfilled sales-order cost on an Average Cost linked return', async () => {
    const connection = connectionFor({ sourceSoItemId: 21, restockLinkedReturn: true, sourceUnitCost: 4.25 });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_change,qty_after_soh,unit_cost,cost_method_snapshot,cost_epoch_id'),
      ['biz-1', 'v-1', 4, 'wholesale', 12, 31, 2, 7, 4.25, 'average_cost', null],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('soi.id = ? AND soi.so_id = ? AND so.business_id = ? AND soi.variant_id = ?'),
      [21, 9, 'biz-1', 'v-1'],
    );
    expect(mockCreateFifoSalesOrderReturnLayers).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it.each([
    { sourceUnitCost: 0, expectedCost: 0 },
    { sourceUnitCost: null, expectedCost: null },
    { sourceUnitCost: -1, expectedCost: null },
    { sourceUnitCost: Number.NaN, expectedCost: null },
    { sourceUnitCost: Number.POSITIVE_INFINITY, expectedCost: null },
  ])('preserves zero or unknown source cost without a catalogue fallback: $sourceUnitCost', async ({ sourceUnitCost, expectedCost }) => {
    const connection = connectionFor({ sourceSoItemId: 21, restockLinkedReturn: true, sourceUnitCost });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_change,qty_after_soh,unit_cost,cost_method_snapshot,cost_epoch_id'),
      ['biz-1', 'v-1', 4, 'wholesale', 12, 31, 2, 7, expectedCost, 'average_cost', null],
    );
  });

  it('records the current Average Cost epoch without changing the captured source cost', async () => {
    mockLockInventoryCostState.mockResolvedValue({ method: 'average_cost', epochId: 8, revision: 3 });
    const connection = connectionFor({ sourceSoItemId: 21, restockLinkedReturn: true, sourceUnitCost: 6.75 });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_change,qty_after_soh,unit_cost,cost_method_snapshot,cost_epoch_id'),
      ['biz-1', 'v-1', 4, 'wholesale', 12, 31, 2, 7, 6.75, 'average_cost', 8],
    );
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_order_items'),
      expect.anything(),
    );
  });

  it('does not write a return movement for a credit-only line', async () => {
    const connection = connectionFor({ sourceSoItemId: 21 });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_stock_movements'),
      expect.anything(),
    );
  });

  it('restores linked sales-order return layers while completing the credit note', async () => {
    mockLockInventoryCostState.mockResolvedValue({ method: 'fifo', epochId: 6, revision: 2 });
    mockCreateFifoSalesOrderReturnLayers.mockResolvedValue({ allocatedValue: 20, unitCost: 10, layerCount: 1 });
    const connection = connectionFor({ sourceSoItemId: 21, restockLinkedReturn: true });

    await ImsCNRepo.complete(12, 'biz-1');

    expect(mockCreateFifoSalesOrderReturnLayers).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1',
      state: { method: 'fifo', epochId: 6, revision: 2 },
      sourceSalesOrderItemId: 21,
      creditNoteId: 12,
      creditNoteItemId: 31,
      returnMovementId: 501,
      variantId: 'v-1',
      locationId: 4,
      quantity: 2,
      returnDate: '2026-09-10',
    });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

describe('ImsSORepo.processShopifyRefund provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLockInventoryCostState.mockResolvedValue({ method: 'fifo', epochId: 6, revision: 2 });
    mockCreateFifoSalesOrderReturnLayers.mockResolvedValue({ allocatedValue: 10, unitCost: 10, layerCount: 1 });
  });

  function refundConnection(options: { pendingReturn?: boolean; duplicate?: boolean; mapped?: boolean } = {}) {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('from ims_sales_orders where id')) return [[{
          id: 9, location_id: 4, so_type: 'online', so_number: 'SHP-9', customer_id: null,
          sales_channel: 'shopify', channel_instance_id: 'shop-1',
        }]];
        if (normalized.includes('from ims_sales_order_items soi')) return [options.mapped === false ? [] : [{ id: 21, variant_id: 'v-1', sku: 'SKU-1', unit_cost: 10 }]];
        if (normalized.includes("status = 'awaiting_product'")) return [options.pendingReturn ? [{ id: 12, location_id: 4 }] : []];
        if (normalized.includes('from ims_credit_notes') && normalized.includes('for update')) return [options.duplicate ? [{ id: 12 }] : []];
        if (normalized.includes('select max(')) return [[{ m: 11 }]];
        if (normalized.startsWith('insert ignore into ims_credit_notes')) return [{ insertId: 12, affectedRows: 1 }];
        if (normalized.startsWith('insert into ims_credit_note_items')) return [{ insertId: 31, affectedRows: 1 }];
        if (normalized.includes('from ims_product_variants pv')) return [[{ is_stock_item: 1 }]];
        if (normalized.includes('select qty_on_hand from ims_stock')) return [[{ qty_on_hand: 1 }]];
        if (normalized.startsWith('insert into ims_stock_movements')) return [{ insertId: 501, affectedRows: 1 }];
        return [{ affectedRows: 1 }];
      }),
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
    return connection;
  }

  const refund = {
    soId: 9, channelInstanceId: 'shop-1', shopifyRefundId: '7001', amount: 5, taxAmount: 0,
    restockLines: [{ externalOrderItemId: '8001', shopifyVariantId: '9001', quantity: 1, restock: true, unitPrice: 5 }],
  };

  it.each([false, true])('restores exact source costs with persisted item IDs (pending return: %s)', async pendingReturn => {
    const connection = refundConnection({ pendingReturn });
    const result = await ImsSORepo.processShopifyRefund('biz-1', { ...refund, ...(pendingReturn ? { shopifyReturnId: '6001' } : {}) });

    expect(result).toEqual({ processed: true, restocked: 1, creditNoteId: 12 });
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining(pendingReturn ? "settlement_method = 'external'" : "'external')"), expect.anything());
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('source_so_item_id)'), expect.anything());
    const inserted = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_credit_note_items'));
    expect((inserted as unknown as [string, unknown[]])[1]).toEqual([12, 'v-1', 'SKU-1', null, 1, 5, 1, 0, 5, 21]);
    expect(mockCreateFifoSalesOrderReturnLayers).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1', state: { method: 'fifo', epochId: 6, revision: 2 }, sourceSalesOrderItemId: 21,
      creditNoteId: 12, creditNoteItemId: 31, returnMovementId: 501, variantId: 'v-1', locationId: 4, quantity: 1,
      returnDate: expect.any(pendingReturn ? Date : String),
    });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back credit and stock when source-allocation restoration fails', async () => {
    const connection = refundConnection();
    mockCreateFifoSalesOrderReturnLayers.mockRejectedValueOnce(new Error('Original allocation missing'));
    await expect(ImsSORepo.processShopifyRefund('biz-1', refund)).rejects.toThrow('Original allocation missing');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rejects unmapped restock lines before credit or stock writes', async () => {
    const connection = refundConnection({ mapped: false });
    await expect(ImsSORepo.processShopifyRefund('biz-1', refund)).rejects.toThrow('not mapped to this sales order');
    expect(mockCreateFifoSalesOrderReturnLayers).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_stock_movements'), expect.anything());
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('does not restock a duplicate refund', async () => {
    const connection = refundConnection({ duplicate: true });
    expect(await ImsSORepo.processShopifyRefund('biz-1', refund)).toEqual({ processed: false, restocked: 0, creditNoteId: 12 });
    expect(mockCreateFifoSalesOrderReturnLayers).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('keeps no-restock refunds value-only', async () => {
    const connection = refundConnection();
    expect(await ImsSORepo.processShopifyRefund('biz-1', { ...refund, restockLines: [{ ...refund.restockLines[0], restock: false }] }))
      .toEqual({ processed: true, restocked: 0, creditNoteId: 12 });
    expect(mockCreateFifoSalesOrderReturnLayers).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_stock_movements'), expect.anything());
  });

  it('uses captured SO-line cost under Average Cost', async () => {
    mockLockInventoryCostState.mockResolvedValue({ method: 'average_cost', epochId: 8, revision: 3 });
    const connection = refundConnection();
    await ImsSORepo.processShopifyRefund('biz-1', refund);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_stock_movements'),
      ['biz-1', 'v-1', 4, 'online', 12, 31, 1, 1, 10, 'average_cost', 8]);
    expect(mockCreateFifoSalesOrderReturnLayers).not.toHaveBeenCalled();
  });
});