import { describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockImsQuery } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: vi.fn(),
  imsQuery: mockImsQuery,
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { ImsPORepo } from '../ImsRepository';

describe('ImsPORepo.get', () => {
  it('starts independent accessory reads concurrently after loading the PO header', async () => {
    let releaseAccessories: (rows: unknown[]) => void = () => {};
    const accessories = new Promise<unknown[]>(resolve => { releaseAccessories = resolve; });
    mockImsQuery
      .mockResolvedValueOnce([{ id: 42, business_id: 'biz-1' }])
      .mockImplementation(() => accessories);

    const resultPromise = ImsPORepo.get(42, 'biz-1');

    await vi.waitFor(() => expect(mockImsQuery).toHaveBeenCalledTimes(5));
    releaseAccessories([]);

    await expect(resultPromise).resolves.toMatchObject({
      id: 42,
      items: [],
      payments: [],
      landed_costs: [],
      files: [],
    });
    expect(mockImsQuery.mock.calls[0][1]).toEqual([42, 42, 'biz-1']);
  });
});

describe('ImsPORepo.update', () => {
  it('preserves existing PO line IDs and inserts only new lines', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) return [[{ status: 'draft', location_id: 4, business_id: 'biz-1' }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[
        { id: 10, variant_id: 'v-1', qty_ordered: 2, qty_received: 0 },
      ]];
      if (sql.includes('SELECT tax_treatment')) return [[{ tax_treatment: 'ex_tax' }]];
      if (sql.includes('SELECT freight, discount')) return [[{ freight: 0, discount: 0 }]];
      if (sql.includes('INSERT INTO ims_purchase_order_items')) return [{ affectedRows: 1, insertId: 31 }];
      return [{ affectedRows: 1 }];
    });
    const connection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      execute,
      release: vi.fn(),
      rollback: vi.fn(),
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsPORepo.update(42, {}, [
      { id: 10, variant_id: 'v-1', qty_ordered: 2, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 10, notes: null },
      { variant_id: 'v-2', qty_ordered: 3, unit_cost: 7, discount_pct: 0, tax_rate: 0.1, line_total: 21, notes: 'Second' },
    ]);

    const inserts = execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO ims_purchase_order_items'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toContain('VALUES (?,?,?,?,?,?,?,?)');
    expect(inserts[0][1]).toHaveLength(8);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ims_purchase_order_items'),
      ['v-1', 2, 5, 0, 0.1, 10, null, 10, 42],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('records the generated ID of a newly inserted PO line in amendment provenance', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) return [[{ status: 'draft', location_id: 4, business_id: 'biz-1' }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[]];
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: 70 }];
      if (sql.includes('INSERT INTO ims_purchase_order_items')) return [{ insertId: 31 }];
      if (sql.includes('SELECT tax_treatment')) return [[{ tax_treatment: 'ex_tax' }]];
      if (sql.includes('SELECT freight, discount')) return [[{ freight: 0, discount: 0 }]];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsPORepo.update(42, {}, [{
      variant_id: 'v-2', qty_ordered: 3, unit_cost: 7, discount_pct: 0, tax_rate: 0.1, line_total: 21, notes: null,
    }], undefined, { operationKey: 'amend-new-line', requestHash: 'b'.repeat(64) });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_order_amendment_lines'),
      ['biz-1', 70, null, 31, 0, null, expect.any(String)],
    );
  });

  it('applies only the net incoming delta for a confirmed quantity edit', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1' }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[
        { id: 10, variant_id: 'v-1', qty_ordered: 5, qty_received: 0 },
      ]];
      if (sql.includes('SELECT qty_incoming')) return [[{ qty_incoming: 9 }]];
      if (sql.includes('SELECT qty_on_hand')) return [[{ qty_on_hand: 6 }]];
      if (sql.includes('SELECT tax_treatment')) return [[{ tax_treatment: 'ex_tax' }]];
      if (sql.includes('SELECT freight, discount')) return [[{ freight: 0, discount: 0 }]];
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsPORepo.update(42, {}, [
      { id: 10, variant_id: 'v-1', qty_ordered: 3, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 15, notes: null },
    ]);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_incoming = qty_incoming + ?'),
      [-2, 'v-1', 4],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, ?, ?, 'purchase_order'"),
      ['biz-1', 'v-1', 4, 'po_unapproved', 42, -2, 6],
    );
  });

  it('rejects a stale edit before changing lines, stock, or amendment history', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1', updated_at: new Date('2026-08-11T10:00:00.000Z') }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsPORepo.update(42, {}, [], undefined, {
      operationKey: 'amend-1', requestHash: 'a'.repeat(64), expectedUpdatedAt: '2026-08-11T09:00:00.000Z',
    })).rejects.toThrow('This order changed after you opened it');

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_purchase_order_items'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('ims_order_amendment_operations'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('replays a completed amendment operation without applying changes twice', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1', updated_at: new Date('2026-08-11T10:00:00.000Z') }]];
      }
      if (sql.includes('FROM ims_purchase_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 5, qty_received: 0 }]];
      }
      if (sql.includes('FROM ims_order_amendment_operations')) {
        return [[{ id: 70, request_hash: 'a'.repeat(64), state: 'complete' }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsPORepo.update(42, {}, [{
      id: 10, variant_id: 'v-1', qty_ordered: 3, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 15, notes: null,
    }], undefined, { operationKey: 'amend-1', requestHash: 'a'.repeat(64) });

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_purchase_order_items'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_stock'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects an amendment operation key reused with different changes', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, location_id')) {
        return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1' }]];
      }
      if (sql.includes('FROM ims_purchase_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 5, qty_received: 0 }]];
      }
      if (sql.includes('FROM ims_order_amendment_operations')) {
        return [[{ id: 70, request_hash: 'a'.repeat(64), state: 'complete' }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsPORepo.update(42, {}, [{
      id: 10, variant_id: 'v-1', qty_ordered: 3, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 15, notes: null,
    }], undefined, { operationKey: 'amend-1', requestHash: 'b'.repeat(64) }))
      .rejects.toThrow('already used with different changes');

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_purchase_order_items'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_stock'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe('ImsPORepo.changeStatus lifecycle boundaries', () => {
  it('replays a completed status operation before revision, line, or stock checks', async () => {
    mockImsQuery.mockResolvedValue([]);
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ims_purchase_orders')) {
        return [[{
          id: 42, status: 'cancelled', location_id: 4, business_id: 'biz-1', is_historical: 0,
          updated_at: new Date('2026-08-11T11:00:00.000Z'),
        }]];
      }
      if (sql.includes('FROM ims_order_amendment_operations')) {
        return [[{ id: 80, request_hash: 'c'.repeat(64), state: 'complete' }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsPORepo.changeStatus(
      42, 'cancelled', 'expense', undefined, '2026-08-11T10:00:00.000Z',
      { operationKey: 'po-status-1', requestHash: 'c'.repeat(64) },
    );

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('FROM ims_purchase_order_items'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => /^(UPDATE ims_stock|INSERT INTO ims_stock|UPDATE ims_purchase_orders)/i.test(String(sql).trim()))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rejects a stale status action before loading lines or changing stock', async () => {
    mockImsQuery.mockResolvedValue([]);
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ims_purchase_orders')) {
        return [[{
          id: 42, status: 'confirmed', location_id: 4, business_id: 'biz-1', is_historical: 0,
          updated_at: new Date('2026-08-11T10:00:00.000Z'),
        }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsPORepo.changeStatus(
      42, 'cancelled', 'expense', undefined, '2026-08-11T09:00:00.000Z',
    )).rejects.toThrow('changed after you opened it');

    expect(execute.mock.calls.some(([sql]) => String(sql).includes('FROM ims_purchase_order_items'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)/i.test(String(sql).trim()))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['partially_received', 'confirmed'],
    ['confirmed', 'complete'],
  ] as const)('rejects %s to %s before changing stock, receipt lines, or status', async (from, to) => {
    mockImsQuery.mockResolvedValue([]);
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ims_purchase_orders')) {
        return [[{ id: 42, status: from, location_id: 4, business_id: 'biz-1', is_historical: 0 }]];
      }
      if (sql.includes('FROM ims_purchase_order_items')) {
        return [[{ id: 10, variant_id: 'v-1', qty_ordered: 5, qty_received: from === 'partially_received' ? 2 : 0 }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), execute, release: vi.fn(), rollback: vi.fn() };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsPORepo.changeStatus(42, to)).rejects.toThrow(`cannot change from ${from} to ${to}`);

    const mutationSql = execute.mock.calls
      .map(([sql]) => String(sql).trim())
      .filter(sql => /^(UPDATE|INSERT|DELETE)/i.test(sql));
    expect(mutationSql).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});