import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(),
  imsExecute: mocks.imsExecute,
  imsQuery: mocks.imsQuery,
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: () => 'stocktake-repository-test' }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { ImsStocktakeRepo } from '../ImsRepository';

describe('ImsStocktakeRepo.delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imsExecute.mockResolvedValue(undefined);
    mocks.imsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SHOW COLUMNS FROM ims_stocktakes LIKE 'business_id'")) return [{ Field: 'business_id' }];
      return [];
    });
  });

  it('deletes an untouched in-progress stocktake and its start history when explicitly discarded', async () => {
    mocks.imsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SHOW COLUMNS FROM ims_stocktakes LIKE 'business_id'")) return [{ Field: 'business_id' }];
      if (sql.includes('SUM(i.counted_qty IS NOT NULL)')) return [{ status: 'in_progress', counted_count: 0 }];
      return [];
    });

    await ImsStocktakeRepo.delete(31, 'biz-1', true);

    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_inventory_document_operations'),
      ['biz-1', 31],
    );
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_stocktakes'),
      [31, 'biz-1'],
    );
  });

  it('refuses to discard an in-progress stocktake with a persisted count', async () => {
    mocks.imsQuery.mockResolvedValue([{ status: 'in_progress', counted_count: 1 }]);

    await expect(ImsStocktakeRepo.delete(31, 'biz-1', true))
      .rejects.toThrow('Only Draft or newly started unsaved stocktakes can be deleted');

    expect(mocks.imsExecute).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ims_stocktakes'),
      expect.anything(),
    );
  });
});