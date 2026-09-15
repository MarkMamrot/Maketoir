import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/channels/amazonInventorySync', () => ({
  syncChangedAmazonInventoryForChannel: mocks.sync,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(secret = 'cron-secret', body: unknown = {}) {
  return new Request('http://localhost/api/ims/channels/amazon/inventory/cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify(body),
  });
}

describe('POST automatic Amazon inventory sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.query.mockResolvedValue([
      { business_id: 'business-1', channel_instance_id: 'instance-1' },
      { business_id: 'business-1', channel_instance_id: 'instance-2' },
    ]);
    mocks.sync.mockResolvedValue({ queued: 2, processed: 2, pushed: 2, skipped: 0, failed: 0 });
    mocks.report.mockResolvedValue(1);
  });

  it('requires the cron secret', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('selects only active ready Amazon instances and synchronizes each exact instance', async () => {
    const response = await POST(request('cron-secret', { limit: 500 }));
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain("instance.provider = 'amazon'");
    expect(mocks.query.mock.calls[0][0]).toContain('instance.is_enabled = 1');
    expect(mocks.query.mock.calls[0][0]).toContain("instance.runtime_status = 'active'");
    expect(mocks.sync).toHaveBeenNthCalledWith(1, {
      businessId: 'business-1', channelInstanceId: 'instance-1', limit: 100,
    });
    expect(await response.json()).toEqual({
      success: true, channels: 2, queued: 4, processed: 4, pushed: 4,
      skipped: 0, failed: 0, failedChannels: 0,
    });
  });

  it('continues other instances and reports a safe operational failure', async () => {
    mocks.sync
      .mockRejectedValueOnce(new Error('provider response detail'))
      .mockResolvedValueOnce({ queued: 1, processed: 1, pushed: 1, skipped: 0, failed: 0 });
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'automatic_inventory_sync',
      context: { channelInstanceId: 'instance-1' },
    }));
    expect(await response.json()).toEqual({
      success: false, channels: 2, queued: 1, processed: 1, pushed: 1,
      skipped: 0, failed: 0, failedChannels: 1,
    });
  });
});