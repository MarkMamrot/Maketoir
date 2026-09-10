import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockLockInventoryCostState, mockCreateFifoPosReturnLayers } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockLockInventoryCostState: vi.fn(),
  mockCreateFifoPosReturnLayers: vi.fn(),
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
  FifoCostingConflict: class FifoCostingConflict extends Error { code = 'FIFO_COSTING_CONFLICT'; status = 409; },
}));

import { ImsCNRepo } from '../ImsRepository';

function connectionFor(options: {
  operationState?: 'processing' | 'complete';
  sourceSoItemId?: number;
  fulfilledQty?: number;
  returnedQty?: number;
  posReturn?: boolean;
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
        variant_id: 'v-1', qty: 2, unit_price: 5, restock: 0,
      }] : []];
    }
    if (normalized.includes('from ims_sales_order_items soi')) {
      return [[{ qty_fulfilled: options.fulfilledQty ?? 2 }]];
    }
    if (normalized.includes('select so_type from ims_sales_orders')) {
      return [[{ so_type: 'wholesale' }]];
    }
    if (normalized.includes('from ims_product_variants pv')) return [[{ is_stock_item: 1 }]];
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
});