import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/channels/amazonOrderSync', () => ({ syncAmazonOrdersForChannel: mocks.sync }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = (secret = 'cron-secret') => new Request('http://localhost/cron', {
  method: 'POST', headers: { 'x-cron-secret': secret },
});

describe('POST automatic Amazon order sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.query.mockResolvedValue([{ business_id: 'business-1', channel_instance_id: 'instance-1' }]);
    mocks.sync.mockResolvedValue({ scanned: 1, imported: 1, updated: 0, skipped: 0, failed: 0, hasMore: false });
    mocks.report.mockResolvedValue(1);
  });

  it('requires the cron secret', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('polls only active ready Amazon instances', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain('instance.is_enabled = 1');
    expect(mocks.query.mock.calls[0][0]).toContain("instance.runtime_status = 'active'");
    expect(mocks.sync).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', limit: 25,
    });
    expect(await response.json()).toMatchObject({ success: true, imported: 1, channels: 1 });
  });

  it('reports one seller failure and continues remaining sellers', async () => {
    mocks.query.mockResolvedValue([
      { business_id: 'business-1', channel_instance_id: 'instance-1' },
      { business_id: 'business-2', channel_instance_id: 'instance-2' },
    ]);
    mocks.sync.mockRejectedValueOnce(new Error('private detail')).mockResolvedValueOnce({
      scanned: 1, imported: 1, updated: 0, skipped: 0, failed: 0, hasMore: true,
    });
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'automatic_order_sync',
    }));
    expect(await response.json()).toMatchObject({ success: false, failedChannels: 1, pendingChannels: 1 });
  });
});