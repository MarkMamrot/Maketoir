import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn(), adapter: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/channels/channelProductPublication', () => ({ syncChannelProductPublications: mocks.sync }));
vi.mock('@/lib/channels/channelProductPublicationAdapters', () => ({ channelProductPublicationAdapter: mocks.adapter }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(secret = 'cron-secret') {
  return new Request('http://localhost/api/ims/channels/product-publication/cron', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify({ limit: 50 }),
  });
}

describe('channel product publication cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.adapter.mockReturnValue(vi.fn());
    mocks.sync.mockResolvedValue({ queued: 1, processed: 1, applied: 1, blocked: 0, skipped: 0, failed: 0 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('rejects requests without the cron secret', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('selects only opted-in active ready channels with business capability and automation enabled', async () => {
    mocks.query.mockResolvedValue([{ business_id: 'business-1', channel_instance_id: 'shopify-1', provider: 'shopify' }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain("'$.productPublicationEnabled'");
    expect(sql).toContain("instance.runtime_status = 'active'");
    expect(sql).toContain('capability.shopify_enabled = 1');
    expect(sql).toContain('COALESCE(business.automation_paused, 0) = 0');
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'shopify-1', provider: 'shopify', limit: 50,
    }));
  });

  it('continues after one channel fails and returns a partial-success response', async () => {
    mocks.query.mockResolvedValue([
      { business_id: 'business-1', channel_instance_id: 'shopify-1', provider: 'shopify' },
      { business_id: 'business-2', channel_instance_id: 'amazon-1', provider: 'amazon' },
    ]);
    mocks.sync
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ queued: 2, processed: 2, applied: 1, blocked: 1, skipped: 0, failed: 0 });
    const response = await POST(request());
    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toMatchObject({
      success: false, channels: 2, failedChannels: 1, queued: 2, processed: 2, applied: 1, blocked: 1,
    });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1' }));
  });
});
