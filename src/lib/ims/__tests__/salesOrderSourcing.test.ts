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

import { confirmSalesOrderWithSourcing, previewSalesOrderSourcing } from '../salesOrderSourcing';

const order = {
  id: 7,
  so_number: 'SO-7',
  status: 'draft',
  location_id: 3,
  location_name: 'Warehouse',
  so_type: 'b2b',
  updated_at: '2026-09-01T10:00:00.000Z',
};

const demand = [{
  so_item_id: 11,
  variant_id: 'variant-1',
  qty_ordered: 8,
  qty_fulfilled: 0,
  sku: 'SKU-1',
  product_name: 'Blue Shirt',
  is_stock_item: 1,
  qty_on_hand: 3,
  qty_committed: 1,
}];

const supply = [{
  po_item_id: 21,
  po_id: 20,
  variant_id: 'variant-1',
  qty_ordered: 10,
  qty_received: 2,
  po_number: 'PO-20',
  expected_date: '2026-09-10',
}];

function mockPreviewQueries() {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM ims_sales_orders so')) return [[order]];
    if (sql.includes('FROM ims_sales_order_items soi')) return [demand];
    if (sql.includes('FROM ims_stock_allocations')) return [[{
      so_item_id: 99,
      po_item_id: 21,
      qty_allocated: 2,
      qty_fulfilled: 0,
      qty_received_assigned: 0,
    }]];
    if (sql.includes('FROM ims_purchase_order_items item')) return [supply];
    throw new Error(`Unexpected query: ${sql}`);
  });
}

describe('sales order sourcing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('separates available stock, eligible incoming supply, and unsourced demand', async () => {
    mockPreviewQueries();

    const preview = await previewSalesOrderSourcing({ businessId: 'biz-1', soId: 7 });

    expect(preview.requiresReview).toBe(true);
    expect(preview.lines[0]).toMatchObject({
      ordered: 8,
      availableNow: 2,
      shortage: 6,
      allocatedIncoming: 0,
      unsourced: 6,
      candidates: [{ poItemId: 21, freeQuantity: 6 }],
    });
  });

  it('rolls back when remaining shortage was not explicitly acknowledged', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_sales_orders')) return [[order]];
      if (sql.includes('SELECT id, variant_id, qty_ordered')) return [[{ id: 11, variant_id: 'variant-1', qty_ordered: 8 }]];
      if (sql.includes('INSERT IGNORE INTO ims_stock')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM ims_sales_orders so')) return [[order]];
      if (sql.includes('FROM ims_sales_order_items soi')) return [demand];
      if (sql.includes('FROM ims_stock_allocations')) return [[]];
      if (sql.includes('FROM ims_purchase_order_items item')) return [supply];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(confirmSalesOrderWithSourcing({
      businessId: 'biz-1',
      soId: 7,
      operationKey: 'confirm-7',
      expectedUpdatedAt: order.updated_at,
      choices: [{ soItemId: 11, poItemId: 21, quantity: 4 }],
      acknowledgedUnsourcedSoItemIds: [],
    })).rejects.toThrow('explicitly leave');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("SET status = 'confirmed'"))).toBe(false);
  });

  it('rejects a sourcing choice for a line outside the locked sales order', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_sales_orders')) return [[order]];
      if (sql.includes('SELECT id, variant_id, qty_ordered')) return [[{ id: 11, variant_id: 'variant-1', qty_ordered: 8 }]];
      if (sql.includes('INSERT IGNORE INTO ims_stock')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM ims_sales_orders so')) return [[order]];
      if (sql.includes('FROM ims_sales_order_items soi')) return [demand];
      if (sql.includes('FROM ims_purchase_order_items item')) return [supply];
      if (sql.includes('FROM ims_stock_allocations')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(confirmSalesOrderWithSourcing({
      businessId: 'biz-1',
      soId: 7,
      operationKey: 'confirm-7',
      choices: [{ soItemId: 999, poItemId: 21, quantity: 1 }],
      acknowledgedUnsourcedSoItemIds: [11],
    })).rejects.toThrow('line is no longer available');
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('commits status and selected incoming protection in one transaction', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('SELECT * FROM ims_sales_orders')) return [[order]];
      if (sql.includes('SELECT id, variant_id, qty_ordered')) return [[{ id: 11, variant_id: 'variant-1', qty_ordered: 8 }]];
      if (sql.includes('INSERT IGNORE INTO ims_stock')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM ims_sales_orders so')) return [[order]];
      if (sql.includes('FROM ims_sales_order_items soi')) return [demand];
      if (sql.includes('FROM ims_stock_allocations')) return [[]];
      if (sql.includes('FROM ims_purchase_order_items item')) return [supply];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: 30 }];
      if (sql.includes('SELECT qty_on_hand FROM ims_stock')) return [[{ qty_on_hand: 3 }]];
      if (sql.includes('INSERT INTO ims_stock_allocation_operations')) return [{ insertId: 31 }];
      if (sql.includes('INSERT INTO ims_stock_allocations')) return [{ insertId: 41 }];
      return [{ affectedRows: 1 }];
    });

    const result = await confirmSalesOrderWithSourcing({
      businessId: 'biz-1',
      soId: 7,
      operationKey: 'confirm-7',
      expectedUpdatedAt: order.updated_at,
      choices: [{ soItemId: 11, poItemId: 21, quantity: 5 }],
      acknowledgedUnsourcedSoItemIds: [11],
      actorId: 4,
      actorName: 'Taylor',
    });

    expect(result).toMatchObject({ replayed: false, allocationIds: [41] });
    expect(result.preview.lines[0]).toMatchObject({ allocatedIncoming: 5, unsourced: 1 });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed'"),
      [7, 'biz-1'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });
});