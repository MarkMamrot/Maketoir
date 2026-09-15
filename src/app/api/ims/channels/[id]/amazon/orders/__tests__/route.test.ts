import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), instance: vi.fn(), sync: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.instance,
} }));
vi.mock('@/lib/channels/amazonOrderSync', () => ({ syncAmazonOrdersForChannel: mocks.sync }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const context = { params: { id: 'instance-1' } };
const request = (body: unknown = {}) => new Request('http://localhost/orders', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('POST Amazon orders sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.instance.mockResolvedValue({ provider: 'amazon' });
    mocks.sync.mockResolvedValue({ scanned: 2, imported: 1, updated: 1, skipped: 0, failed: 0, hasMore: false });
    mocks.report.mockResolvedValue(1);
  });

  it('requires an administrator and an exact Amazon channel', async () => {
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request(), context)).status).toBe(403);
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.instance.mockResolvedValueOnce({ provider: 'shopify' });
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('synchronizes the exact seller and bounds the batch size', async () => {
    const response = await POST(request({ limit: 500 }), context);
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', limit: 100,
    });
    expect(await response.json()).toMatchObject({ success: true, imported: 1, updated: 1 });
  });

  it('reports route failures without exposing provider details', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('private provider response'));
    const response = await POST(request(), context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Amazon orders could not be synchronized.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'sync_orders',
    }));
  });
});