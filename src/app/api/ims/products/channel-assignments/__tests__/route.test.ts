import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), listInstances: vi.fn(), query: vi.fn(), setOverrides: vi.fn(), syncPublications: vi.fn(),
  publicationAdapter: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  listForBusiness: mocks.listInstances,
} }));
vi.mock('@/lib/channels/channelProductAssignmentRepository', () => ({
  setChannelProductOverrides: mocks.setOverrides,
}));
vi.mock('@/lib/channels/channelProductPublication', () => ({
  syncChannelProductPublications: mocks.syncPublications,
}));
vi.mock('@/lib/channels/channelProductPublicationAdapters', () => ({
  channelProductPublicationAdapter: mocks.publicationAdapter,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/products/channel-assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('bulk product channel assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.listInstances.mockResolvedValue([
      { channelInstanceId: 'channel-1', provider: 'shopify', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready' },
      { channelInstanceId: 'channel-2', provider: 'native_shop', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready' },
    ]);
    mocks.query.mockResolvedValue([{ product_id: 'product-1' }, { product_id: 'product-2' }]);
    mocks.setOverrides.mockResolvedValue(2);
    mocks.publicationAdapter.mockReturnValue('adapter');
    mocks.syncPublications.mockResolvedValue({ queued: 2, processed: 2, applied: 2, blocked: 0, skipped: 0, failed: 0 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('updates only the selected exact channel instances', async () => {
    const response = await POST(request({ productIds: ['product-1', 'product-2'],
      channelInstanceIds: ['channel-1', 'channel-2'], action: 'include' }));
    expect(response.status).toBe(200);
    expect(mocks.setOverrides).toHaveBeenNthCalledWith(1, {
      businessId: 'business-1', channelInstanceId: 'channel-1',
      productIds: ['product-1', 'product-2'], overrideMode: 'include',
    });
    expect(mocks.setOverrides).toHaveBeenNthCalledWith(2, expect.objectContaining({ channelInstanceId: 'channel-2' }));
    expect(mocks.syncPublications).toHaveBeenNthCalledWith(1, expect.objectContaining({
      channelInstanceId: 'channel-1', productIds: ['product-1', 'product-2'], limit: 2,
    }));
  });

  it('maps allow automation without changing unrelated channels', async () => {
    await POST(request({ productIds: ['product-1'], channelInstanceIds: ['channel-2'], action: 'allow_automation' }));
    expect(mocks.setOverrides).toHaveBeenCalledOnce();
    expect(mocks.setOverrides).toHaveBeenCalledWith(expect.objectContaining({
      channelInstanceId: 'channel-2', overrideMode: 'automatic',
    }));
    expect(mocks.syncPublications).not.toHaveBeenCalled();
  });

  it('retains inclusion but returns a visible failure when provider publication is blocked', async () => {
    mocks.syncPublications.mockResolvedValue({ queued: 1, processed: 1, applied: 0, blocked: 1, skipped: 0, failed: 0 });

    const response = await POST(request({ productIds: ['product-1'], channelInstanceIds: ['channel-1'], action: 'include' }));
    const body = await response.json();

    expect(body).toMatchObject({ success: false, partial: false, error: 'Inclusion was saved, but 1 product publication action requires attention.' });
    expect(mocks.setOverrides).toHaveBeenCalledOnce();
  });

  it('rejects unknown products or channels before writing', async () => {
    mocks.query.mockResolvedValue([{ product_id: 'product-1' }]);
    const response = await POST(request({ productIds: ['product-1', 'missing'],
      channelInstanceIds: ['channel-1'], action: 'include' }));
    expect(response.status).toBe(404);
    expect(mocks.setOverrides).not.toHaveBeenCalled();
  });

  it('reports per-channel partial failures without rolling back successful channels', async () => {
    mocks.setOverrides.mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('database unavailable'));
    const response = await POST(request({ productIds: ['product-1', 'product-2'],
      channelInstanceIds: ['channel-1', 'channel-2'], action: 'exclude' }));
    expect(await response.json()).toMatchObject({ success: false, partial: true, results: [
      { channelInstanceId: 'channel-1', success: true, applied: 2 },
      { channelInstanceId: 'channel-2', success: false, applied: 0 },
    ] });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'bulk_channel_assignment',
    }));
  });
});