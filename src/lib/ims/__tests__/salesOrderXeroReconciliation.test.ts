import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), sync: vi.fn(), void: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerSOXeroUpdate: mocks.update,
  triggerSOXeroSync: mocks.sync,
  triggerSOXeroVoid: mocks.void,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { reconcileSalesOrderTransferXero } from '../orderTransfers/salesOrderXeroReconciliation';

describe('sales order transfer Xero reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mocks.sync.mockResolvedValue(undefined);
    mocks.void.mockResolvedValue(null);
    mocks.report.mockResolvedValue(1);
  });

  it('updates an open source and syncs the destination after commit', async () => {
    await reconcileSalesOrderTransferXero('biz-1', [{
      replayed: false, sourceOrderId: 17, targetOrderId: 18,
      sourceStatus: 'confirmed', targetStatus: 'confirmed',
    }]);

    expect(mocks.update).toHaveBeenCalledWith('biz-1', 17);
    expect(mocks.sync).toHaveBeenCalledWith('biz-1', 18, 'confirmed');
  });

  it('voids a source invoice when moving all outstanding quantity closes it', async () => {
    await reconcileSalesOrderTransferXero('biz-1', [{
      replayed: false, sourceOrderId: 17, targetOrderId: 18,
      sourceStatus: 'cancelled', targetStatus: 'confirmed',
    }]);

    expect(mocks.void).toHaveBeenCalledWith('biz-1', 17);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});