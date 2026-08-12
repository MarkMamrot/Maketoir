import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), apply: vi.fn(), get: vi.fn(), refresh: vi.fn(), report: vi.fn() }));
vi.mock('@/app/api/ims/import/_helpers', () => ({ getImportSession: mocks.session }));
vi.mock('@/lib/ims/stocktakes/stocktakeOperations', () => ({
  applyStocktake: mocks.apply,
  StocktakeOperationConflict: class StocktakeOperationConflict extends Error { code = 'stocktake_operation_conflict'; },
}));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsStocktakeRepo: { get: mocks.get } }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mocks.refresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';

const params = { params: { id: '31' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/stocktakes/31/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/stocktakes/[id]/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.apply.mockResolvedValue({ id: 31, status: 'completed', applied: 1, variances: 1, countStartVariances: 2, replayed: false });
    mocks.get.mockResolvedValue({ id: 31, items: [{ variant_id: 'v-1' }] });
    mocks.refresh.mockResolvedValue(undefined);
  });

  it('requires an operation key', async () => {
    const response = await POST(request({ expectedUpdatedAt: 'revision' }) as any, params);
    expect(response.status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('passes tenant, revision, actor, and stable operation context', async () => {
    const response = await POST(request({ operationKey: 'stable-key', expectedUpdatedAt: 'revision' }) as any, params);
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', stocktakeId: 31,
      context: expect.objectContaining({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', actorId: 7, actorName: 'Alex' }),
    }));
  });

  it('maps guarded stocktake conflicts to 409 without reporting a Runtime Issue', async () => {
    mocks.apply.mockRejectedValue(new StocktakeOperationConflict('Stock changed.'));
    const response = await POST(request({ operationKey: 'key' }) as any, params);
    expect(response.status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({ operationKey: 'key' }) as any, params)).status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
