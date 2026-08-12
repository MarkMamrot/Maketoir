import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), revert: vi.fn(), xero: vi.fn(), report: vi.fn() }));
vi.mock('@/app/api/ims/import/_helpers', () => ({ getImportSession: mocks.session }));
vi.mock('@/lib/ims/stocktakes/stocktakeOperations', () => ({
  revertStocktake: mocks.revert,
  StocktakeOperationConflict: class StocktakeOperationConflict extends Error { code = 'stocktake_operation_conflict'; },
}));
vi.mock('@/services/XeroSyncService', () => ({ syncStocktakeReversalJournal: mocks.xero }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';

const params = { params: { id: '31' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/stocktakes/31/revert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/stocktakes/[id]/revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.revert.mockResolvedValue({ id: 31, status: 'reverted', reverted: 1, replayed: false, xeroReversalStatus: 'queued' });
    mocks.xero.mockResolvedValue({ journalId: 'reversal-1', lines: 1, totalValue: 11 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an operation key and reason', async () => {
    expect((await POST(request({ reason: 'Mistake' }) as any, params)).status).toBe(400);
    expect((await POST(request({ operationKey: 'key' }) as any, params)).status).toBe(400);
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it('normalizes the reason and posts the reversing journal after local correction', async () => {
    const response = await POST(request({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', reason: '  Counted twice  ' }) as any, params);
    expect(response.status).toBe(200);
    expect(mocks.revert).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', stocktakeId: 31, reason: 'Counted twice',
      context: expect.objectContaining({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', actorId: 7 }),
    }));
    expect(mocks.xero).toHaveBeenCalledWith('biz-1', 31);
    expect(await response.json()).toMatchObject({ status: 'reverted', xeroReversalStatus: 'synced', xeroWarning: null });
  });

  it('preserves local success and reports when the post-commit Xero correction fails', async () => {
    mocks.xero.mockRejectedValue(new Error('Xero unavailable'));
    const response = await POST(request({ operationKey: 'key', reason: 'Mistake' }) as any, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'reverted', xeroWarning: 'Xero unavailable' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'xero_reversal_journal', context: { localReversalCommitted: true },
    }));
  });

  it('maps guarded reversal conflicts to 409 without calling Xero', async () => {
    mocks.revert.mockRejectedValue(new StocktakeOperationConflict('Stock would fall below zero.'));
    const response = await POST(request({ operationKey: 'key', reason: 'Mistake' }) as any, params);
    expect(response.status).toBe(409);
    expect(mocks.xero).not.toHaveBeenCalled();
  });
});
