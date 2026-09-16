import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), setEnabled: vi.fn(), status: vi.fn(), sync: vi.fn(),
  adapter: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance,
  setProductPublicationEnabledForBusiness: mocks.setEnabled,
} }));
vi.mock('@/lib/channels/channelProductPublication', () => ({
  getChannelProductPublicationStatus: mocks.status,
  syncChannelProductPublications: mocks.sync,
}));
vi.mock('@/lib/channels/channelProductPublicationAdapters', () => ({ channelProductPublicationAdapter: mocks.adapter }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH, POST } from '../route';

const context = { params: { id: 'instance-1' } };
function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/ims/channels/instance-1/product-publication', {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function instance(settings: Record<string, unknown> = {}) {
  return { channelInstanceId: 'instance-1', provider: 'shopify', enabled: true,
    runtimeStatus: 'active', readinessStatus: 'ready', settings };
}

describe('channel product publication route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue(instance());
    mocks.status.mockResolvedValue({ needsPublication: 2, blocked: 0, pendingJobs: 0, failedJobs: 0 });
    mocks.sync.mockResolvedValue({ queued: 2, processed: 2, applied: 2, blocked: 0, skipped: 0, failed: 0 });
    mocks.adapter.mockReturnValue(vi.fn());
  });

  it('reports status without enabling execution', async () => {
    const response = await GET(request('GET'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, needsPublication: 2 });
  });

  it('persists the exact-channel rollout gate', async () => {
    mocks.setEnabled.mockResolvedValue(instance({ productPublicationEnabled: 1 }));
    const response = await PATCH(request('PATCH', { enabled: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.setEnabled).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1', enabled: true });
  });

  it('refuses execution while the rollout gate is disabled', async () => {
    const response = await POST(request('POST', { enqueue: true }), context);
    expect(response.status).toBe(409);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('enqueues and processes only an enabled active ready instance', async () => {
    mocks.getInstance.mockResolvedValue(instance({ productPublicationEnabled: true }));
    const response = await POST(request('POST', { enqueue: true, limit: 50 }), context);
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'shopify', enqueue: true, limit: 50,
    }));
  });
});
