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
  it('replaces all PO lines with one multi-row insert', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status')) return [[{ status: 'draft' }]];
      if (sql.includes('SELECT tax_treatment')) return [[{ tax_treatment: 'ex_tax' }]];
      if (sql.includes('SELECT freight, discount')) return [[{ freight: 0, discount: 0 }]];
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
      { variant_id: 'v-1', qty_ordered: 2, unit_cost: 5, discount_pct: 0, tax_rate: 0.1, line_total: 10, notes: null },
      { variant_id: 'v-2', qty_ordered: 3, unit_cost: 7, discount_pct: 0, tax_rate: 0.1, line_total: 21, notes: 'Second' },
    ]);

    const inserts = execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO ims_purchase_order_items'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toContain('VALUES (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)');
    expect(inserts[0][1]).toHaveLength(16);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});