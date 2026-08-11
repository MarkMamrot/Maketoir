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
  imsQuery: vi.fn(async () => [
    { Field: 'price_tier' },
    { Field: 'tax_treatment' },
    { Field: 'so_type' },
  ]),
  imsExecute: vi.fn(),
}));

vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { ImsSORepo } from '../ImsRepository';

describe('ImsSORepo.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax', so_type: 'b2b' }]];
      }
      if (sql.includes('FROM ims_sales_order_items')) {
        return [[{ id: 10, variant_id: 'old-size', qty_ordered: 1, qty_fulfilled: 0 }]];
      }
      if (sql.includes('COALESCE(p.is_stock_item')) {
        return [[{ variant_id: 'old-size', is_stock_item: 1 }, { variant_id: 'new-size', is_stock_item: 1 }]];
      }
      if (sql.includes('qty_on_hand, qty_committed')) {
        return [[{ qty_on_hand: 8, qty_committed: 1 }]];
      }
      if (sql.includes('SELECT freight, discount')) {
        return [[{ freight: 0, discount: 0, tax_treatment: 'inc_tax' }]];
      }
      if (sql.includes('SELECT qty_on_hand FROM ims_stock')) {
        return [[{ qty_on_hand: 8 }]];
      }
      return [{ affectedRows: 1 }];
    });
  });

  it('moves committed stock to the edited Shopify variant', async () => {
    await ImsSORepo.update(42, {}, [{
      id: 10,
      shopify_line_item_id: '9002',
      variant_id: 'new-size',
      qty_ordered: 1,
      unit_price: 59.95,
      discount_pct: 0,
      tax_rate: 0.1,
      line_total: 59.95,
      notes: 'T-shirt / Large',
    }]);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_order_items'),
      ['9002', 'new-size', 1, 59.95, 0, 0.1, 59.95, 'T-shirt / Large', 10, 42],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + ?'),
      [-1, 'old-size', 4],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['new-size', 4, 'biz-1', 1],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('records the generated ID of a newly inserted SO line in amendment provenance', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'draft', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax', so_type: 'b2b' }]];
      }
      if (sql.includes('FROM ims_sales_order_items')) return [[]];
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: 70 }];
      if (sql.includes('INSERT INTO ims_sales_order_items')) return [{ insertId: 31 }];
      if (sql.includes('SELECT freight, discount')) return [[{ freight: 0, discount: 0, tax_treatment: 'inc_tax' }]];
      return [{ affectedRows: 1 }];
    });

    await ImsSORepo.update(42, {}, [{
      variant_id: 'new-size', qty_ordered: 1, unit_price: 59.95,
      discount_pct: 0, tax_rate: 0.1, line_total: 59.95, notes: null,
    }], { operationKey: 'amend-new-line', requestHash: 'b'.repeat(64) });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_order_amendment_lines'),
      ['biz-1', 70, null, 31, 0, null, expect.any(String)],
    );
  });

  it('rejects line changes while a customer backorder is held', async () => {
    execute.mockResolvedValueOnce([[{
      status: 'backordered', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax',
    }]]);

    await expect(ImsSORepo.update(42, {}, [{
      variant_id: 'v-1', qty_ordered: 2, unit_price: 10, discount_pct: 0, tax_rate: 0.1, line_total: 20,
    }])).rejects.toThrow('Release this customer backorder');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM ims_sales_order_items'))).toBe(false);
  });

  it('preserves fulfilled quantities by rejecting commercial line changes after shipment', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'fulfilled', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax' }]];
      }
      if (sql.includes('FROM ims_sales_order_items')) {
        return [[{
          id: 10, variant_id: 'shipped-size', qty_ordered: 1, qty_fulfilled: 1,
          unit_price: 59.95, discount_pct: 0, tax_rate: 0.1, notes: null,
        }]];
      }
      return [{ affectedRows: 1 }];
    });

    await expect(ImsSORepo.update(42, {}, [{
      variant_id: 'shipped-size', qty_ordered: 1, unit_price: 59.95,
      discount_pct: 0, tax_rate: 0.1, line_total: 59.95, notes: null,
    }, {
      variant_id: 'new-size', qty_ordered: 1, unit_price: 59.95,
      discount_pct: 0, tax_rate: 0.1, line_total: 59.95, notes: null,
    }])).rejects.toThrow('cannot be changed after any quantity has been fulfilled');

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM ims_sales_order_items'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('allows metadata edits after shipment without replacing line rows', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'partially_fulfilled', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax' }]];
      }
      if (sql.includes('FROM ims_sales_order_items')) {
        return [[{
          id: 10, variant_id: 'shipped-size', qty_ordered: 2, qty_fulfilled: 1,
          unit_price: 59.95, discount_pct: 0, tax_rate: 0.1, notes: null,
        }]];
      }
      return [{ affectedRows: 1 }];
    });

    await ImsSORepo.update(42, { notes: 'Updated delivery note' }, [{
      variant_id: 'shipped-size', qty_ordered: 2, unit_price: 59.95,
      discount_pct: 0, tax_rate: 0.1, line_total: 119.9, notes: null,
    }]);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_orders SET notes = ?'),
      ['Updated delivery note', 42],
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM ims_sales_order_items'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

describe('ImsSORepo.changeStatus customer backorder release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rolls back when locked stock does not cover all commitments', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{ id: 42, status: 'backordered', location_id: 4, business_id: 'biz-1', is_historical: 0 }]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 2 }]];
      }
      if (sql.includes('SELECT qty_on_hand, qty_committed')) {
        return [[{ qty_on_hand: 4, qty_committed: 5 }]];
      }
      return [{ affectedRows: 1 }];
    });

    await expect(ImsSORepo.changeStatus(42, 'confirmed')).rejects.toThrow('not ready');
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_stock'),
      ['v-1', 4],
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET status ='))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('releases ready stock without changing its retained commitment', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{ id: 42, status: 'backordered', location_id: 4, business_id: 'biz-1', is_historical: 0 }]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 2 }]];
      }
      if (sql.includes('SELECT qty_on_hand, qty_committed')) {
        return [[{ qty_on_hand: 5, qty_committed: 5 }]];
      }
      return [{ affectedRows: 1 }];
    });

    await ImsSORepo.changeStatus(42, 'confirmed');
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_sales_orders SET status = ?'),
      ['confirmed', 42],
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET qty_committed'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

describe('ImsSORepo.changeStatus partial fulfilment safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fulfils only the outstanding quantity from a partially fulfilled order', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{
          id: 42, status: 'partially_fulfilled', location_id: 4, business_id: 'biz-1', so_type: 'b2b', is_historical: 0,
        }]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 7, unit_cost: 4 }]];
      }
      if (sql.includes('COALESCE(pv.avg_cost')) {
        return [[{ qty_on_hand: 8, qty_committed: 3, avg_cost: 5 }]];
      }
      return [{ affectedRows: 1 }];
    });

    await ImsSORepo.changeStatus(42, 'fulfilled');

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [5, 3, 'v-1', 4],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?,?,'so_fulfilled'"),
      ['v-1', 4, 'wholesale', 42, -3, 5, 5],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('releases only outstanding commitment when cancelling a partial order', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{ id: 42, status: 'partially_fulfilled', location_id: 4, business_id: 'biz-1', is_historical: 0 }]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 7 }]];
      }
      return [{ affectedRows: 1 }];
    });

    await ImsSORepo.changeStatus(42, 'cancelled');

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [3, 'v-1', 4],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects an unlisted transition before changing stock or status', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) {
        return [[{ id: 42, status: 'fulfilled', location_id: 4, business_id: 'biz-1', is_historical: 0 }]];
      }
      if (sql.includes('SELECT * FROM ims_sales_order_items')) return [[]];
      return [{ affectedRows: 1 }];
    });

    await expect(ImsSORepo.changeStatus(42, 'draft')).rejects.toThrow(
      'Sales order cannot change from fulfilled to draft.',
    );

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET status ='))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});