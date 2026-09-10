import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  changeStatus: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/ims/ImsRepository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ims/ImsRepository')>('@/lib/ims/ImsRepository');
  return {
    ...actual,
    ImsBTRepo: { ...actual.ImsBTRepo, changeStatus: mocks.changeStatus },
  };
});
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { PUT } from '../route';

describe('PUT branch transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'biz-1' });
  });

  it('returns FIFO layer shortages as actionable conflicts', async () => {
    mocks.changeStatus.mockRejectedValue(new FifoCostingConflict(
      'Cannot complete this stock movement for variant v-1: FIFO layers at this location cover 2 units, but 3 are required. Reconcile the missing 1 units before retrying.',
    ));

    const response = await PUT(new Request('http://localhost/api/ims/branch-transfers/42', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'received' }),
    }), { params: { id: '42' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'FIFO_COSTING_CONFLICT',
      error: expect.stringContaining('Reconcile the missing 1 units'),
    });
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });
});