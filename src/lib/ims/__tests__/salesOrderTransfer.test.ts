import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const transferAllocation = vi.hoisted(() => vi.fn());
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute,
};

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));
vi.mock('../stockAllocation/service', () => ({
  transferStockAllocationsToBackorderLine: transferAllocation,
}));

import {
  SalesOrderTransferConflict,
  transferSalesOrderItems,
  transferSalesOrderItemsInTransaction,
} from '../orderTransfers/salesOrderTransfer';

const sourceOrder = {
  id: 10,
  business_id: 'biz-1',
  status: 'confirmed',
  customer_id: 7,
  location_id: 3,
  currency_code: 'AUD',
  exchange_rate: 1,
  tax_treatment: 'inc_tax',
  tax_code: 'OUTPUT',
  payment_terms: '30 days',
  price_tier: 'retail',
  customer_po_number: null,
  so_type: 'b2b',
  is_historical: 0,
  xero_invoice_id: null,
  has_payments: 0,
  has_submitted_shipment: 0,
  freight: 5,
  discount: 0,
  updated_at: '2026-04-01T00:00:00.000Z',
};

const targetOrder = {
  ...sourceOrder,
  id: 20,
  freight: 0,
  updated_at: '2026-04-02T00:00:00.000Z',
};

const sourceItem = {
  id: 101,
  business_id: 'biz-1',
  so_id: 10,
  variant_id: 'variant-1',
  qty_ordered: 5,
  qty_fulfilled: 1,
  unit_price: 11,
  unit_cost: 4,
  discount_pct: 0,
  tax_rate: 0.1,
  line_total: 55,
  notes: null,
  is_stock_item: 1,
};

const targetItem = {
  ...sourceItem,
  id: 201,
  so_id: 20,
  qty_ordered: 2,
  qty_fulfilled: 0,
  line_total: 22,
};

describe('transferSalesOrderItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transferAllocation.mockResolvedValue(1.25);
    let amendmentId = 700;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_sales_orders so')) return [[sourceOrder, targetOrder]];
      if (sql.includes('FROM ims_sales_order_items item')) return [[{ ...sourceItem }, { ...targetItem }]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: amendmentId++ }];
      if (sql.includes('SUM(GREATEST(0, qty_allocated')) return [[{ available: 2 }]];
      return [{ affectedRows: 1 }];
    });
  });

  it('atomically moves outstanding quantity and the selected incoming allocation into a matching line', async () => {
    const result = await transferSalesOrderItems({
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: 20,
      operationKey: 'move-10-to-20',
      expectedSourceUpdatedAt: sourceOrder.updated_at,
      expectedTargetUpdatedAt: targetOrder.updated_at,
      lines: [{ sourceItemId: 101, quantity: 2.5, allocatedIncomingQuantity: 1.25 }],
    });

    expect(result).toEqual(expect.objectContaining({
      replayed: false,
      sourceOrderId: 10,
      targetOrderId: 20,
      sourceStatus: 'confirmed',
      variantIds: ['variant-1'],
      movedLines: [{
        sourceItemId: 101,
        targetItemId: 201,
        variantId: 'variant-1',
        quantity: 2.5,
        allocatedIncomingQuantity: 1.25,
      }],
    }));
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_order_items SET qty_ordered = ?'),
      [4.5, 49.5, 'biz-1', 20, 201],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_order_items SET qty_ordered = ?'),
      [2.5, 27.5, 'biz-1', 10, 101],
    );
    expect(transferAllocation).toHaveBeenCalledWith(connection, {
      businessId: 'biz-1',
      sourceSoItemId: 101,
      backorderSoId: 20,
      backorderSoItemId: 201,
      quantity: 1.25,
    });
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('ims_stock_movements'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock '))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rolls back when the selected protected incoming quantity is no longer available', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_sales_orders so')) return [[sourceOrder, targetOrder]];
      if (sql.includes('FROM ims_sales_order_items item')) return [[{ ...sourceItem }, { ...targetItem }]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: 700 }];
      if (sql.includes('SUM(GREATEST(0, qty_allocated')) return [[{ available: 0.5 }]];
      return [{ affectedRows: 1 }];
    });

    await expect(transferSalesOrderItems({
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: 20,
      operationKey: 'move-stale-allocation',
      lines: [{ sourceItemId: 101, quantity: 2, allocatedIncomingQuantity: 1 }],
    })).rejects.toThrow(SalesOrderTransferConflict);

    expect(transferAllocation).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('leaves an externally owned transaction open for a multi-source coordinator', async () => {
    await transferSalesOrderItemsInTransaction(connection, {
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: 20,
      operationKey: 'move-10-to-20-in-batch',
      lines: [{ sourceItemId: 101, quantity: 2, allocatedIncomingQuantity: 1.25 }],
    });

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('creates a new compatible destination inside the same transaction', async () => {
    transferAllocation.mockResolvedValue(1);
    let amendmentId = 800;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_sales_orders so')) return [[sourceOrder]];
      if (sql.includes('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('MAX(CAST(SUBSTRING_INDEX(so_number')) return [[{ max_seq: 41 }]];
      if (sql.includes('INSERT INTO ims_sales_orders')) return [{ insertId: 30 }];
      if (sql.includes('FROM ims_sales_order_items item')) return [[{ ...sourceItem }]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: amendmentId++ }];
      if (sql.includes('SUM(GREATEST(0, qty_allocated')) return [[{ available: 2 }]];
      if (sql.includes('INSERT INTO ims_sales_order_items')) return [{ insertId: 301 }];
      return [{ affectedRows: 1 }];
    });

    const result = await transferSalesOrderItems({
      businessId: 'biz-1',
      sourceOrderId: 10,
      createTarget: true,
      operationKey: 'move-10-to-new',
      expectedSourceUpdatedAt: sourceOrder.updated_at,
      lines: [{ sourceItemId: 101, quantity: 2, allocatedIncomingQuantity: 1 }],
    });

    expect(result).toEqual(expect.objectContaining({
      sourceOrderId: 10,
      targetOrderId: 30,
      targetOrderNumber: `SO-${new Date().getFullYear()}-0042`,
      targetStatus: 'confirmed',
    }));
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_sales_orders'),
      expect.arrayContaining(['biz-1', `SO-${new Date().getFullYear()}-0042`, 7, 3, 'confirmed']),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_sales_order_items'),
      ['biz-1', 30, 'variant-1', 2, 11, 4, 0, 0.1, 22, null],
    );
    expect(transferAllocation).toHaveBeenCalledWith(connection, expect.objectContaining({
      sourceSoItemId: 101,
      backorderSoId: 30,
      backorderSoItemId: 301,
      quantity: 1,
    }));
    expect(execute).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['ims:biz-1:so:number']);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('does not attach protected incoming supply to a Draft destination', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_sales_orders so')) return [[
        sourceOrder,
        { ...targetOrder, status: 'draft' },
      ]];
      return [{ affectedRows: 1 }];
    });

    await expect(transferSalesOrderItems({
      businessId: 'biz-1',
      sourceOrderId: 10,
      targetOrderId: 20,
      operationKey: 'move-protection-to-draft',
      lines: [{ sourceItemId: 101, quantity: 1, allocatedIncomingQuantity: 0.5 }],
    })).rejects.toThrow('Protected incoming supply cannot move to a Draft Sales Order.');

    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
