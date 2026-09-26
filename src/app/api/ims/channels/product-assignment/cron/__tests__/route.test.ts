import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/channels/channelProductAssignmentAutomation', () => ({ runChannelProductAssignmentAutomation: mocks.run }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(secret = 'cron-secret') {
  return new Request('http://localhost/api/ims/channels/product-assignment/cron', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ batchSize: 250 }),
  });
}

describe('channel product assignment cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.query.mockResolvedValue([{ business_id: 'business-1', channel_instance_id: 'channel-1', assignment_mode: 'add_matches' }]);
    mocks.run.mockResolvedValue({ evaluated: 4, batches: 1 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('rejects requests without the cron secret', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('selects only opted-in channels on automation-enabled businesses', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain("= 'add_matches'");
    expect(sql).not.toContain('full_sync');
    expect(sql).toContain("instance.runtime_status = 'active'");
    expect(sql).toContain("instance.readiness_status = 'ready'");
    expect(sql).toContain('instance.enabled = 1');
    expect(sql).toContain('COALESCE(business.automation_paused, 0) = 0');
    expect(mocks.run).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'channel-1',
      mode: 'add_matches', batchSize: 250 });
  });

  it('continues after a channel failure and reports it', async () => {
    mocks.query.mockResolvedValue([
      { business_id: 'business-1', channel_instance_id: 'channel-1', assignment_mode: 'add_matches' },
      { business_id: 'business-2', channel_instance_id: 'channel-2', assignment_mode: 'add_matches' },
    ]);
    mocks.run.mockRejectedValueOnce(new Error('tenant unavailable')).mockResolvedValueOnce({ evaluated: 3, batches: 1 });
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ success: false, channels: 2, evaluated: 3, failedChannels: 1 });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'automatic_product_assignment',
    }));
  });
});