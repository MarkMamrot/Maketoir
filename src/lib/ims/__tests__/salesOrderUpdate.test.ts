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
        return [[{ status: 'confirmed', location_id: 4, business_id: 'biz-1', tax_treatment: 'inc_tax' }]];
      }
      if (sql.includes('SELECT variant_id, qty_ordered')) {
        return [[{ variant_id: 'old-size', qty_ordered: 1 }]];
      }
      if (sql.includes('SELECT freight, discount')) {
        return [[{ freight: 0, discount: 0, tax_treatment: 'inc_tax' }]];
      }
      return [{ affectedRows: 1 }];
    });
  });

  it('moves committed stock to the edited Shopify variant', async () => {
    await ImsSORepo.update(42, {}, [{
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
      expect.stringContaining('(so_id,shopify_line_item_id,variant_id'),
      [42, '9002', 'new-size', 1, 59.95, 0, 0.1, 59.95, 'T-shirt / Large'],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [1, 'old-size', 4],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['new-size', 4, 'biz-1', 1],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});