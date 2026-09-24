import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), evaluate: vi.fn() }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/channels/channelProductAssignmentRepository', () => ({ evaluateChannelProducts: mocks.evaluate }));

import { runChannelProductAssignmentAutomation } from '../channelProductAssignmentAutomation';

describe('channel product assignment automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockImplementation(async (_businessId: string, work: () => Promise<unknown>) => work());
  });

  it('evaluates the exact channel in bounded tenant-scoped batches', async () => {
    mocks.evaluate
      .mockResolvedValueOnce({ products: Array.from({ length: 2 }, () => ({})), applied: 2 })
      .mockResolvedValueOnce({ products: [{}], applied: 1 });
    await expect(runChannelProductAssignmentAutomation({ businessId: 'business-1', channelInstanceId: 'channel-1',
      mode: 'add_matches', batchSize: 2 })).resolves.toEqual({ evaluated: 3, batches: 2 });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.evaluate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'channel-1', assignmentMode: 'add_matches', apply: true,
      limit: 2, offset: 0,
    }));
    expect(mocks.evaluate).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 2 }));
  });
});