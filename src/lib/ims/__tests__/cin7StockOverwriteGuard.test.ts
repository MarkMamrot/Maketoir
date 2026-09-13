import { beforeEach, describe, expect, it, vi } from 'vitest';

const imsQuery = vi.hoisted(() => vi.fn());

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery }));

import {
  assertCin7StockOverwriteAllowed,
  CIN7_BUILD_STOCK_GUARD_MESSAGE,
  CIN7_FIFO_STOCK_GUARD_MESSAGE,
} from '../builds/cin7StockOverwriteGuard';

describe('assertCin7StockOverwriteAllowed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows Average Cost replacement when no completed build movements exist', async () => {
    imsQuery
      .mockResolvedValueOnce([{ active_method: 'average_cost' }])
      .mockResolvedValueOnce([{ has_build_movements: 0 }]);

    await expect(assertCin7StockOverwriteAllowed('biz-1')).resolves.toBeUndefined();
  });

  it('blocks stock replacement while FIFO is active before checking build history', async () => {
    imsQuery.mockResolvedValueOnce([{ active_method: 'fifo' }]);

    await expect(assertCin7StockOverwriteAllowed('biz-1')).rejects.toMatchObject({
      code: 'FIFO_COSTING_CONFLICT',
      message: CIN7_FIFO_STOCK_GUARD_MESSAGE,
    });
    expect(imsQuery).toHaveBeenCalledTimes(1);
  });

  it('retains the completed-build guard under Average Cost', async () => {
    imsQuery
      .mockResolvedValueOnce([{ active_method: 'average_cost' }])
      .mockResolvedValueOnce([{ has_build_movements: 1 }]);

    await expect(assertCin7StockOverwriteAllowed('biz-1')).rejects.toThrow(CIN7_BUILD_STOCK_GUARD_MESSAGE);
  });
});