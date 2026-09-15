import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), markSetup: vi.fn(), enqueue: vi.fn(), process: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, markAmazonSetupOperationForBusiness: mocks.markSetup,
} }));
vi.mock('@/lib/channels/amazonInventorySync', () => ({
  enqueueAmazonInventoryJobs: mocks.enqueue,
  processAmazonInventoryJobs: mocks.process,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const context = { params: { id: 'instance-1' } };
function request(body: unknown = {}) {
  return new Request('http://localhost/api/ims/channels/instance-1/amazon/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST Amazon channel inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'amazon' });
    mocks.enqueue.mockResolvedValue(3);
    mocks.process.mockResolvedValue({ processed: 3, pushed: 2, skipped: 1, failed: 0 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an administrator and an exact Amazon instance', async () => {
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request(), context)).status).toBe(403);
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('queues and processes inventory in the exact business and channel instance', async () => {
    const response = await POST(request({ limit: 500 }), context);
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1' });
    expect(mocks.process).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1', limit: 100 });
    expect(mocks.markSetup).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', operation: 'inventory',
    });
    expect(await response.json()).toEqual({ success: true, queued: 3, processed: 3, pushed: 2, skipped: 1, failed: 0 });
  });

  it('can drain a subsequent batch without requeueing completed jobs', async () => {
    await POST(request({ enqueue: false, limit: 25 }), context);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.process).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1', limit: 25 });
  });

  it('reports failures without returning provider details', async () => {
    mocks.process.mockRejectedValue(new Error('provider response detail'));
    const response = await POST(request(), context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Amazon inventory could not be synchronized.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'sync_amazon_inventory',
    }));
  });
});