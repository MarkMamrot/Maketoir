import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool } = vi.hoisted(() => ({ mockGetIMSPool: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { ImsSupplierCNRepo } from '../ImsRepository';

function connectionFor(options: { status?: string; onHand?: number; isStockItem?: number; sourcePoItemId?: number; returnedQty?: number } = {}) {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from ims_supplier_credit_notes') && normalized.includes('for update')) {
      return [[{ id: 7, business_id: 'biz-1', status: options.status ?? 'draft', location_id: 4, po_id: options.sourcePoItemId ? 9 : null }]];
    }
    if (normalized.includes('from ims_supplier_credit_note_items') && normalized.includes('for update')) {
      return [[{ id: 11, scn_id: 7, variant_id: 'v-1', qty: 3, unit_cost: 5, restock: 1, source_po_item_id: options.sourcePoItemId }]];
    }
    if (normalized.includes('from ims_purchase_order_items poi')) {
      return [[{ qty_received: 5 }]];
    }
    if (normalized.includes('sum(scni.qty)')) {
      return [[{ returned_qty: options.returnedQty ?? 0 }]];
    }
    if (normalized.includes('from ims_product_variants pv') && normalized.includes('is_stock_item')) {
      return [[{ is_stock_item: options.isStockItem ?? 1 }]];
    }
    if (normalized.includes('select s.qty_on_hand') && normalized.includes('for update')) {
      return [[{ qty_on_hand: options.onHand ?? 5, avg_cost: 4.5 }]];
    }
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

describe('ImsSupplierCNRepo.complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locks stock and records one tenant-scoped physical return', async () => {
    const connection = connectionFor();

    await ImsSupplierCNRepo.complete(7, 'biz-1');

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT IGNORE INTO ims_stock (business_id, variant_id, location_id)'),
      ['biz-1', 'v-1', 4],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT s\.qty_on_hand[\s\S]*FOR UPDATE/),
      ['v-1', 4],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('(business_id,variant_id,location_id,movement_type'),
      ['biz-1', 'v-1', 4, 7, -3, 2, 4.5],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('treats an already-complete supplier credit as a successful replay', async () => {
    const connection = connectionFor({ status: 'complete' });

    await expect(ImsSupplierCNRepo.complete(7, 'biz-1')).resolves.toBeUndefined();

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_supplier_credit_note_items'),
      expect.anything(),
    );
  });

  it('rolls back before stock mutation when the return exceeds on-hand quantity', async () => {
    const connection = connectionFor({ onHand: 2 });

    await expect(ImsSupplierCNRepo.complete(7, 'biz-1')).rejects.toThrow(
      'Cannot return variant v-1: 2 units are on hand at this location, but 3 units would leave.',
    );

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("'scn_returned'"),
      expect.anything(),
    );
  });

  it('skips stock movement for non-stock supplier credit lines', async () => {
    const connection = connectionFor({ isStockItem: 0 });

    await ImsSupplierCNRepo.complete(7, 'biz-1');

    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT s.qty_on_hand'),
      expect.anything(),
    );
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("'scn_returned'"),
      expect.anything(),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('blocks cumulative linked returns above the received source quantity', async () => {
    const connection = connectionFor({ sourcePoItemId: 21, returnedQty: 4 });

    await expect(ImsSupplierCNRepo.complete(7, 'biz-1')).rejects.toThrow(
      'Return quantity for purchase order line 21 exceeds the remaining returnable quantity of 1.',
    );

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("'scn_returned'"),
      expect.anything(),
    );
  });

  it('creates the header and linked lines atomically under a tenant number lock', async () => {
    const connection = connectionFor();
    connection.execute.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('select get_lock')) return [[{ acquired: 1 }]];
      if (normalized.includes('max(cast(regexp_replace(scn_number')) return [[{ max_num: 8 }]];
      if (normalized.startsWith('insert into ims_supplier_credit_notes')) return [{ insertId: 41 }];
      return [{ affectedRows: 1 }];
    });

    await expect(ImsSupplierCNRepo.create({
      location_id: 4,
      scn_date: '2026-03-01',
      tax_treatment: 'ex_tax',
    }, [{
      variant_id: 'v-1',
      qty: 2,
      unit_cost: 5,
      restock: true,
      tax_rate: 0.1,
      source_po_item_id: null,
    }], 'biz-1')).resolves.toBe(41);

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('(scn_id,variant_id,code,name,qty,unit_cost,restock,source_po_item_id'),
      [41, 'v-1', null, null, 2, 5, 1, null, 0.1, 10],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['ims:scn-number:biz-1']);
    expect(connection.release).toHaveBeenCalledOnce();
  });
});