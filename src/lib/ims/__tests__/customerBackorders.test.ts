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

import { splitCustomerBackorder } from '../backorders/customerBackorders';

describe('splitCustomerBackorder', () => {
  let quantityOnHand = 10;

  beforeEach(() => {
    vi.clearAllMocks();
    quantityOnHand = 10;
    let insertedItemId = 200;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{
          id: 42,
          business_id: 'biz-1',
          so_number: 'SO-2026-0042',
          so_type: 'b2b',
          status: 'confirmed',
          customer_id: 7,
          customer_po_number: 'CPO-9',
          location_id: 4,
          tax_treatment: 'inc_tax',
          price_tier: 'wholesale',
          freight: 5,
          discount: 0,
          xero_invoice_id: null,
        }]];
      }
      if (sql.includes('FROM ims_so_backorder_lines')) return [[]];
      if (sql.includes('FROM ims_sales_order_payments')) return [[]];
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[
          { id: 10, so_id: 42, variant_id: 'variant-1', qty_ordered: 5, unit_price: 11, discount_pct: 0, tax_rate: 0.1, notes: null },
          { id: 11, so_id: 42, variant_id: 'variant-2', qty_ordered: 1, unit_price: 22, discount_pct: 0, tax_rate: 0.1, notes: null },
        ]];
      }
      if (sql.includes('SELECT qty_on_hand FROM ims_stock')) return [[{ qty_on_hand: quantityOnHand }]];
      if (sql.includes('SELECT so_number FROM ims_sales_orders')) return [[]];
      if (sql.includes('INSERT INTO ims_sales_orders')) return [{ insertId: 99 }];
      if (sql.includes('INSERT INTO ims_sales_order_items')) return [{ insertId: ++insertedItemId }];
      if (sql.includes('COALESCE(pv.avg_cost')) return [[{ qty_on_hand: quantityOnHand, avg_cost: 4.5 }]];
      return [{ affectedRows: 1 }];
    });
  });

  it('moves shortfalls to a held order and fulfils only actual quantities', async () => {
    const result = await splitCustomerBackorder({
      businessId: 'biz-1',
      soId: 42,
      operationKey: 'split-42-1',
      fulfilQuantities: [
        { itemId: 10, quantity: 2 },
        { itemId: 11, quantity: 0 },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      sourceSoId: 42,
      backorderSoId: 99,
      backorderSoNumber: 'SO-2026-0042-B',
      fulfilledVariantIds: ['variant-1'],
    }));
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("'backordered'"),
      expect.arrayContaining(['biz-1', 'SO-2026-0042-B']),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_sales_order_items'),
      [11],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [8, 2, 'variant-1', 4],
    );
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO ims_so_backorder_lines'))).toHaveLength(2);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('returns the existing child without repeating stock or line mutations on retry', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{ id: 42, business_id: 'biz-1', status: 'backordered' }]];
      }
      if (sql.includes('FROM ims_so_backorder_lines')) {
        return [[{ backorder_so_id: 99, so_number: 'SO-2026-0042-B' }]];
      }
      return [{ affectedRows: 1 }];
    });

    const result = await splitCustomerBackorder({
      businessId: 'biz-1', soId: 42, operationKey: 'split-42-1',
      fulfilQuantities: [{ itemId: 10, quantity: 2 }],
    });

    expect(result).toEqual({
      sourceSoId: 42,
      backorderSoId: 99,
      backorderSoNumber: 'SO-2026-0042-B',
      operationKey: 'split-42-1',
      fulfilledVariantIds: [],
    });
    expect(execute.mock.calls.some(([sql]) => /UPDATE ims_stock|INSERT INTO ims_sales_orders|INSERT INTO ims_sales_order_items/.test(String(sql)))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('requires an explicit override before a backorder split makes stock negative', async () => {
    quantityOnHand = 1;

    await expect(splitCustomerBackorder({
      businessId: 'biz-1', soId: 42, operationKey: 'split-42-short',
      fulfilQuantities: [{ itemId: 10, quantity: 2 }, { itemId: 11, quantity: 0 }],
    })).rejects.toMatchObject({
      code: 'STOCK_SHORTFALL',
      shortfalls: [{ itemId: 10, quantityOnHand: 1, requestedQuantity: 2, resultingQuantityOnHand: -1 }],
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('allows a confirmed backorder split to make stock negative', async () => {
    quantityOnHand = 1;

    await splitCustomerBackorder({
      businessId: 'biz-1', soId: 42, operationKey: 'split-42-short-confirmed',
      fulfilQuantities: [{ itemId: 10, quantity: 2 }, { itemId: 11, quantity: 0 }],
      allowNegativeStock: true,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_stock SET qty_on_hand = ?'),
      [-1, 2, 'variant-1', 4],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});