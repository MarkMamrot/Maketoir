import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute,
};

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({
    getConnection: vi.fn(async () => connection),
    execute,
  })),
}));

import {
  assignReceiptToStockAllocations,
  buildStockAllocationMutationRequestHash,
  buildStockAllocationRequestHash,
  createStockAllocation,
  listStockAllocationCandidates,
  mutateStockAllocation,
  StockAllocationConflict,
  transferStockAllocationsToBackorderLine,
  transferStockAllocationsToSupplierBackorderLine,
} from '../stockAllocation/service';

const input = {
  businessId: 'biz-1',
  operationKey: 'allocate-1',
  soItemId: 11,
  poItemId: 21,
  quantity: 4,
  promisedDate: '2026-09-10',
  actorId: 7,
  actorName: 'Alex',
};

function mockNewAllocation(options?: { soAllocated?: number; poAllocated?: number }) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM ims_sales_order_items')) return [[{
      id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
      business_id: 'biz-1', location_id: 4, status: 'confirmed',
    }]];
    if (sql.includes('FROM ims_purchase_order_items')) return [[{
      id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
      business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
    }]];
    if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
    if (sql.includes('WHERE business_id = ? AND so_item_id')) {
      return [options?.soAllocated ? [{ qty_allocated: options.soAllocated, qty_fulfilled: 0 }] : []];
    }
    if (sql.includes('WHERE business_id = ? AND po_item_id')) {
      return [options?.poAllocated ? [{ qty_allocated: options.poAllocated, qty_received_assigned: 0 }] : []];
    }
    if (sql.includes('INSERT INTO ims_stock_allocation_operations')) return [{ insertId: 31 }];
    if (sql.includes('INSERT INTO ims_stock_allocations')) return [{ insertId: 41 }];
    return [{ affectedRows: 1 }];
  });
}

describe('stock allocation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one protected allocation and completes its operation atomically', async () => {
    mockNewAllocation();

    await expect(createStockAllocation(input)).resolves.toEqual({ allocationId: 41, replayed: false });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_stock_allocations'),
      ['biz-1', 1, 11, 2, 21, 'v-1', 4, 4, '2026-09-08', '2026-09-10', 'confirmed', 0, null, 7, 'Alex'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('replays a completed matching request without inserting another allocation', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed',
      }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
      }]];
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[{
        request_hash: buildStockAllocationRequestHash(input),
        state: 'complete',
        response_json: { allocationId: 41 },
      }]];
      return [[]];
    });

    await expect(createStockAllocation(input)).resolves.toEqual({ allocationId: 41, replayed: true });
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock_allocations'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects changed payload reuse before capacity or allocation writes', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed',
      }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
      }]];
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[{
        request_hash: buildStockAllocationRequestHash({ ...input, quantity: 3 }),
        state: 'complete', response_json: { allocationId: 40 },
      }]];
      return [[]];
    });

    await expect(createStockAllocation(input)).rejects.toBeInstanceOf(StockAllocationConflict);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock_allocations'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('rejects demand or supply over-allocation under the locked rows', async () => {
    mockNewAllocation({ soAllocated: 5 });
    await expect(createStockAllocation(input)).rejects.toThrow('sales order line quantity');

    vi.clearAllMocks();
    mockNewAllocation({ poAllocated: 7 });
    await expect(createStockAllocation(input)).rejects.toThrow('purchase order quantity');
  });

  it('assigns receipt quantities to allocations in locked priority order', async () => {
    const receiptExecute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocations')) return [[
        { id: 1, so_id: 10, so_item_id: 101, qty_allocated: 3, qty_received_assigned: 1 },
        { id: 2, so_id: 20, so_item_id: 201, qty_allocated: 4, qty_received_assigned: 0 },
      ]];
      return [{ affectedRows: 1 }];
    });

    await expect(assignReceiptToStockAllocations({ execute: receiptExecute }, {
      businessId: 'biz-1', poItemId: 21, receivedQuantity: 5,
    })).resolves.toEqual([
      { allocationId: 1, soId: 10, soItemId: 101, quantity: 2, ready: true },
      { allocationId: 2, soId: 20, soItemId: 201, quantity: 3, ready: false },
    ]);
    expect(receiptExecute).toHaveBeenNthCalledWith(2, expect.stringContaining('qty_received_assigned = qty_received_assigned + ?'), [2, 1, 'biz-1']);
    expect(receiptExecute).toHaveBeenNthCalledWith(3, expect.stringContaining('qty_received_assigned = qty_received_assigned + ?'), [3, 2, 'biz-1']);
  });

  it('reassigns an active allocation to eligible free incoming supply', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_stock_allocations')) return [[{
        id: 41, business_id: 'biz-1', po_id: 2, po_item_id: 21, variant_id: 'v-1', location_id: 4,
        qty_allocated: 4, qty_received_assigned: 0, qty_fulfilled: 0, source_expected_date: '2026-09-08',
        state: 'active', revision: 3,
      }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 22, po_id: 3, variant_id: 'v-1', qty_ordered: 8, qty_received: 0,
        location_id: 4, status: 'confirmed', expected_date: '2026-09-20',
      }]];
      if (sql.includes('AND id <> ?')) return [[]];
      if (sql.includes('INSERT INTO ims_stock_allocation_operations')) return [{ insertId: 51 }];
      return [{ affectedRows: 1 }];
    });

    await expect(mutateStockAllocation({
      businessId: 'biz-1', operationKey: 'reassign-41', allocationId: 41, revision: 3,
      action: 'reassign', poItemId: 22, reason: 'Supplier delivery moved', actorId: 7, actorName: 'Alex',
    })).resolves.toEqual({ allocationId: 41, revision: 4, state: 'active', replayed: false });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_stock_allocations SET'), expect.arrayContaining([
      3, 22, 4, '2026-09-20', 'reassign', 'Supplier delivery moved', 4, 41, 'biz-1', 3,
    ]));
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects a stale allocation revision before mutation writes', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_stock_allocations')) return [[{ id: 41, state: 'active', revision: 4 }]];
      return [[]];
    });
    await expect(mutateStockAllocation({
      businessId: 'biz-1', operationKey: 'release-41', allocationId: 41, revision: 3,
      action: 'release', reason: 'Customer cancelled',
    })).rejects.toThrow('Refresh and try again');
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_stock_allocations SET'))).toBe(false);
  });

  it('does not reassign an allocation after receipt provenance is assigned', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_stock_allocations')) return [[{
        id: 41, state: 'active', revision: 3, qty_allocated: 4, qty_received_assigned: 1, qty_fulfilled: 0,
      }]];
      return [[]];
    });
    await expect(mutateStockAllocation({
      businessId: 'biz-1', operationKey: 'reassign-received', allocationId: 41, revision: 3,
      action: 'reassign', poItemId: 22, reason: 'Move supply',
    })).rejects.toThrow('Received allocation quantities cannot be reassigned');
  });

  it('rejects a resize that exceeds free incoming PO quantity', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_stock_allocations')) return [[{
        id: 41, state: 'active', revision: 3, so_item_id: 11, po_item_id: 21,
        qty_allocated: 4, qty_received_assigned: 0, qty_fulfilled: 0,
      }]];
      if (sql.includes('FROM ims_sales_order_items')) return [[{ qty_ordered: 10, qty_fulfilled: 0 }]];
      if (sql.includes('AND so_item_id = ?')) return [[]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{ qty_ordered: 5, qty_received: 0 }]];
      if (sql.includes('AND po_item_id = ?')) return [[]];
      return [[]];
    });
    await expect(mutateStockAllocation({
      businessId: 'biz-1', operationKey: 'resize-too-large', allocationId: 41, revision: 3,
      action: 'resize', quantity: 6,
    })).rejects.toThrow('purchase order quantity');
  });

  it('rejects changed mutation payload reuse', async () => {
    const original = {
      businessId: 'biz-1', operationKey: 'resize-41', allocationId: 41, revision: 3,
      action: 'resize' as const, quantity: 3,
    };
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[{
        request_hash: buildStockAllocationMutationRequestHash(original), state: 'complete',
        response_json: { allocationId: 41, revision: 4, state: 'active' },
      }]];
      return [[]];
    });
    await expect(mutateStockAllocation({ ...original, quantity: 2 })).rejects.toThrow('different request');
  });

  it('splits an allocation when only part transfers to a held child line', async () => {
    const transferExecute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_stock_allocations')) return [[{
        id: 41, po_id: 2, po_item_id: 21, variant_id: 'v-1', location_id: 4,
        qty_allocated: 5, qty_received_assigned: 2, qty_fulfilled: 0,
        source_expected_date: '2026-09-08', promised_date: '2026-09-10', promise_status: 'confirmed',
        priority: 1, override_reason: null, risk_reason: null, created_by: 7, created_by_name: 'Alex',
      }]];
      return [{ affectedRows: 1, insertId: 61 }];
    });

    await expect(transferStockAllocationsToBackorderLine({ execute: transferExecute }, {
      businessId: 'biz-1', sourceSoItemId: 11, backorderSoId: 99, backorderSoItemId: 201, quantity: 3,
    })).resolves.toBe(3);
    expect(transferExecute).toHaveBeenNthCalledWith(2, expect.stringContaining('qty_allocated = qty_allocated - ?'), [3, 2, 41, 'biz-1']);
    expect(transferExecute).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO ims_stock_allocations'), expect.arrayContaining([
      'biz-1', 99, 201, 2, 21, 'v-1', 4, 3, 2, '2026-09-08', '2026-09-10', 'confirmed',
    ]));
  });

  it('moves supplier shortfall allocations to the held child PO at risk', async () => {
    const transferExecute = vi.fn().mockResolvedValue([{ affectedRows: 2 }]);
    await expect(transferStockAllocationsToSupplierBackorderLine({ execute: transferExecute }, {
      businessId: 'biz-1', sourcePoItemId: 21, backorderPoId: 88, backorderPoItemId: 221,
    })).resolves.toBe(2);
    expect(transferExecute).toHaveBeenCalledWith(
      expect.stringContaining("promise_status = 'at_risk'"),
      [88, 221, 'biz-1', 21],
    );
  });

  it('lists FIFO PO candidates using free incoming quantity after other allocations', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        so_item_id: 11, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
        sku: 'SKU-1', product_name: 'Product', location_id: 4, status: 'confirmed',
      }]];
      if (sql.includes('FROM ims_stock_allocations')) return [[
        { so_item_id: 11, po_item_id: 21, qty_allocated: 3, qty_fulfilled: 0, qty_received_assigned: 0 },
        { so_item_id: 99, po_item_id: 21, qty_allocated: 4, qty_fulfilled: 0, qty_received_assigned: 0 },
      ]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[
        { po_item_id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2, po_number: 'PO-2', expected_date: '2026-09-08', location_id: 4 },
        { po_item_id: 22, po_id: 3, variant_id: 'v-1', qty_ordered: 8, qty_received: 0, po_number: 'PO-3', expected_date: '2026-09-20', location_id: 4 },
      ]];
      return [[]];
    });

    await expect(listStockAllocationCandidates({ businessId: 'biz-1', soId: 1 })).resolves.toEqual([expect.objectContaining({
      soItemId: 11, outstanding: 8, allocatedIncoming: 3, unsourced: 5,
      candidates: [
        expect.objectContaining({ poItemId: 21, freeQuantity: 3 }),
        expect.objectContaining({ poItemId: 22, freeQuantity: 8 }),
      ],
    })]);
  });
});