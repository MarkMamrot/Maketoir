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
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));

import { buildBackorderMergeRequestHash, mergeCustomerBackorders, mergeSupplierBackorders } from '../backorders/mergeBackorders';

const sharedHeader = {
  business_id: 'biz-1',
  status: 'backordered',
  location_id: 4,
  currency_code: 'AUD',
  exchange_rate: 1,
  tax_treatment: 'inc_tax',
  tax_code: 'GST',
  payment_terms: 'Net 30',
  freight: 0,
  discount: 0,
};

describe('mergeBackorders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_backorder_merges')) return [[]];
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[
          { ...sharedHeader, id: 11, so_number: 'SO-11-B', customer_id: 7, customer_po_number: 'CPO-1', price_tier: 'wholesale' },
          { ...sharedHeader, id: 12, so_number: 'SO-12-B', customer_id: 7, customer_po_number: 'CPO-1', price_tier: 'wholesale' },
        ]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[
          { id: 101, so_id: 11, variant_id: 'v-1', qty_ordered: 2, unit_price: 11, discount_pct: 0, tax_rate: 0.1, line_total: 22, notes: null },
          { id: 102, so_id: 12, variant_id: 'v-1', qty_ordered: 3, unit_price: 11, discount_pct: 0, tax_rate: 0.1, line_total: 33, notes: null },
        ]];
      }
      if (sql.includes('SELECT * FROM ims_purchase_orders')) {
        return [[
          { ...sharedHeader, id: 21, po_number: 'PO-21-B', supplier_id: 9, supplier_invoice_number: null },
          { ...sharedHeader, id: 22, po_number: 'PO-22-B', supplier_id: 9, supplier_invoice_number: null },
        ]];
      }
      if (sql.includes('SELECT * FROM ims_purchase_order_items')) {
        return [[
          { id: 201, po_id: 21, variant_id: 'v-1', qty_ordered: 2, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 10, notes: null },
          { id: 202, po_id: 22, variant_id: 'v-2', qty_ordered: 4, unit_cost: 8, discount_pct: 0, tax_rate: 0.1, line_total: 32, notes: null },
        ]];
      }
      if (sql.includes('INSERT INTO ims_purchase_order_items')) return [{ insertId: 299 }];
      return [{ affectedRows: 1 }];
    });
  });

  it('merges customer quantities without changing stock commitments', async () => {
    const result = await mergeCustomerBackorders({
      businessId: 'biz-1',
      orderIds: [11, 12],
      operationKey: 'merge-so-1',
    });

    expect(result).toMatchObject({ targetOrderId: 11, sourceOrderIds: [12], targetOrderNumber: 'SO-11-B' });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_ordered = ?, line_total = ?'),
      [5, 55, 101],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'cancelled'"),
      ['biz-1', 12],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET so_id = ?, so_item_id = ?'),
      [11, 101, 'biz-1', 12, 102],
    );
    expect(execute.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO)\s+ims_stock\s/i.test(String(sql)))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('mirrors the merge for supplier incoming quantities', async () => {
    const result = await mergeSupplierBackorders({
      businessId: 'biz-1',
      orderIds: [21, 22],
      operationKey: 'merge-po-1',
    });

    expect(result).toMatchObject({ type: 'supplier', targetOrderId: 21, sourceOrderIds: [22] });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_purchase_order_items'),
      ['biz-1', 21, 'v-2', 4, 8, 0, 0.1, 32, null],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_po_backorder_lines'),
      [21, 299, 'biz-1', 22, 202],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET po_id = ?, po_item_id = ?'),
      [21, 299, 'biz-1', 22, 202],
    );
    expect(execute.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO)\s+ims_stock\s/i.test(String(sql)))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('hashes merge identity independently of selected order order', () => {
    expect(buildBackorderMergeRequestHash('customer', [12, 11, 12]))
      .toBe(buildBackorderMergeRequestHash('customer', [11, 12]));
    expect(buildBackorderMergeRequestHash('supplier', [11, 12]))
      .not.toBe(buildBackorderMergeRequestHash('customer', [11, 12]));
  });

  it('rejects changed payload reuse before loading or mutating orders', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_backorder_merges')) return [[{
        target_order_id: 11,
        source_order_ids: [12],
        request_hash: buildBackorderMergeRequestHash('customer', [11, 12]),
      }]];
      return [[]];
    });

    await expect(mergeCustomerBackorders({
      businessId: 'biz-1',
      orderIds: [11, 13],
      operationKey: 'merge-so-1',
    })).rejects.toThrow('different request');
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SELECT * FROM ims_sales_orders'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('UPDATE'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
