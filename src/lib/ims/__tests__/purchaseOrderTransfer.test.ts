import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const connection = {
  beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
};
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));

import {
  PurchaseOrderTransferConflict,
  transferPurchaseOrderItems,
  transferPurchaseOrderItemsInTransaction,
} from '../orderTransfers/purchaseOrderTransfer';

const sourceOrder = {
  id: 10, po_number: 'PO-10', business_id: 'biz-1', status: 'partially_received', supplier_id: 7,
  location_id: 3, currency_code: 'AUD', exchange_rate: 1, tax_treatment: 'inc_tax', tax_code: 'INPUT',
  payment_terms: '30 days', supplier_invoice_number: null, is_historical: 0, cin7_order_id: null,
  xero_bill_id: null, has_payments: 0, freight: 5, discount: 0,
  expected_date: '2026-10-01', updated_at: '2026-09-01T00:00:00.000Z',
};
const targetOrder = {
  ...sourceOrder, id: 20, po_number: 'PO-20', status: 'confirmed', freight: 0,
  expected_date: '2026-10-15', updated_at: '2026-09-02T00:00:00.000Z',
};
const sourceItem = {
  id: 101, business_id: 'biz-1', po_id: 10, variant_id: 'variant-1', qty_ordered: 10,
  qty_received: 3, unit_cost: 11, discount_pct: 0, tax_rate: 0.1, line_total: 110,
  notes: null, is_stock_item: 1,
};
const targetItem = { ...sourceItem, id: 201, po_id: 20, qty_ordered: 2, qty_received: 0, line_total: 22 };
const allocation = {
  id: 501, revision: 2, business_id: 'biz-1', po_id: 10, po_item_id: 101,
  so_id: 40, so_item_id: 401, variant_id: 'variant-1', location_id: 3,
  qty_allocated: 4, qty_received_assigned: 1, qty_fulfilled: 0,
  source_expected_date: '2026-10-01', promised_date: '2026-10-20', promise_status: 'confirmed',
  state: 'active', priority: 10, override_reason: null, created_by: 8, created_by_name: 'Alex',
};

describe('transferPurchaseOrderItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let amendmentId = 700;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_purchase_orders po')) return [[sourceOrder, targetOrder]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{ ...sourceItem }, { ...targetItem }]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: amendmentId++ }];
      if (sql.includes('FROM ims_stock_allocations')) return [[allocation]];
      return [{ affectedRows: 1 }];
    });
  });

  it('moves outstanding supply and only the selected part of a named customer promise', async () => {
    const result = await transferPurchaseOrderItems({
      businessId: 'biz-1', sourceOrderId: 10, targetOrderId: 20, operationKey: 'move-po-1',
      expectedSourceUpdatedAt: sourceOrder.updated_at, expectedTargetUpdatedAt: targetOrder.updated_at,
      lines: [{ sourceItemId: 101, quantity: 4, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    });

    expect(result).toEqual(expect.objectContaining({
      sourceOrderId: 10, targetOrderId: 20, targetOrderNumber: 'PO-20', sourceStatus: 'partially_received',
      movedLines: [expect.objectContaining({ sourceItemId: 101, targetItemId: 201, quantity: 4, protectedQuantity: 2 })],
    }));
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_purchase_order_items SET qty_ordered = ?'),
      [6, 66, 'biz-1', 20, 201],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_purchase_order_items SET qty_ordered = ?'),
      [6, 66, 'biz-1', 10, 101],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_allocated = qty_allocated - ?'),
      [2, 'biz-1', 501, 2],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_stock_allocations'),
      ['biz-1', 40, 401, 20, 201, 'variant-1', 3, 2, '2026-10-15', '2026-10-20', 10, null,
        'Protected supply moved to another Purchase Order.', 8, 'Alex'],
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock '))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('ims_stock_movements'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rolls back when moved quantity would strand an unselected customer promise', async () => {
    await expect(transferPurchaseOrderItems({
      businessId: 'biz-1', sourceOrderId: 10, targetOrderId: 20, operationKey: 'move-po-too-much',
      lines: [{ sourceItemId: 101, quantity: 6, allocations: [] }],
    })).rejects.toThrow(PurchaseOrderTransferConflict);

    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('leaves an externally owned transaction open for a multi-source coordinator', async () => {
    await transferPurchaseOrderItemsInTransaction(connection, {
      businessId: 'biz-1', sourceOrderId: 10, targetOrderId: 20, operationKey: 'move-po-in-batch',
      lines: [{ sourceItemId: 101, quantity: 4, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    });

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('creates a compatible active destination atomically under the tenant number lock', async () => {
    let amendmentId = 700;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_purchase_orders po')) return [[sourceOrder]];
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('MAX(CAST(SUBSTRING_INDEX(po_number')) return [[{ max_seq: 12 }]];
      if (sql.includes('INSERT INTO ims_purchase_orders')) return [{ insertId: 30 }];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{ ...sourceItem }]];
      if (sql.includes('INSERT INTO ims_purchase_order_items')) return [{ insertId: 301 }];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: amendmentId++ }];
      if (sql.includes('FROM ims_stock_allocations')) return [[allocation]];
      return [{ affectedRows: 1 }];
    });

    const result = await transferPurchaseOrderItems({
      businessId: 'biz-1', sourceOrderId: 10, createTarget: true, operationKey: 'move-po-new',
      expectedSourceUpdatedAt: sourceOrder.updated_at,
      lines: [{ sourceItemId: 101, quantity: 4, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    });

    expect(result).toEqual(expect.objectContaining({
      targetOrderId: 30, targetOrderNumber: 'PO-2026-0013', targetStatus: 'confirmed',
    }));
    expect(execute).toHaveBeenCalledWith('SELECT GET_LOCK(?, 10) AS acquired', ['ims:biz-1:po:number']);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_purchase_orders'),
      expect.arrayContaining(['biz-1', 'PO-2026-0013', 7, 3, 'confirmed']),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_stock_allocations'),
      expect.arrayContaining(['biz-1', 40, 401, 30, 301]),
    );
    expect(execute).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['ims:biz-1:po:number']);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});