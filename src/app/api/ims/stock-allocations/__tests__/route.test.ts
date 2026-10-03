import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  suggestions: vi.fn(),
  batch: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  candidates: vi.fn(),
  mutate: vi.fn(),
  report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/stockAllocation/suggestionService', () => ({ loadStockAllocationSuggestions: mocks.suggestions }));
vi.mock('@/lib/ims/stockAllocation/batchService', () => ({ createStockAllocationBatch: mocks.batch }));
vi.mock('@/lib/ims/stockAllocation/service', () => ({
  createStockAllocation: mocks.create,
  listStockAllocationCandidates: mocks.candidates,
  listStockAllocations: mocks.list,
  mutateStockAllocation: mocks.mutate,
  StockAllocationConflict: class StockAllocationConflict extends Error {},
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

describe('/api/ims/stock-allocations reviewed suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Operator' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('returns the current suggestion preview', async () => {
    mocks.suggestions.mockResolvedValue([{ soItemId: 11, poItemId: 21, quantity: 2 }]);

    const response = await GET(new Request('http://localhost/api/ims/stock-allocations?suggestions=true'));

    expect(await response.json()).toMatchObject({ success: true, data: [{ soItemId: 11, poItemId: 21, quantity: 2 }] });
    expect(mocks.suggestions).toHaveBeenCalledWith('biz-1');
  });

  it('sends the reviewed set to the atomic batch service', async () => {
    mocks.batch.mockResolvedValue({ allocationIds: [41, 42], replayed: false });
    const request = new Request('http://localhost/api/ims/stock-allocations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationKey: 'review-1',
        allocations: [
          { soItemId: 13, poItemId: 21, quantity: 4, priority: 1 },
          { soItemId: 11, poItemId: 21, quantity: 2, priority: 2 },
        ],
      }),
    });

    const response = await POST(request);

    expect(await response.json()).toMatchObject({ success: true, data: { allocationIds: [41, 42] } });
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operationKey: 'review-1', actorId: 7,
      allocations: [
        expect.objectContaining({ soItemId: 13, poItemId: 21, quantity: 4, priority: 1 }),
        expect.objectContaining({ soItemId: 11, poItemId: 21, quantity: 2, priority: 2 }),
      ],
    }));
  });
});