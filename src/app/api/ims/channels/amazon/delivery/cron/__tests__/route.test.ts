import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), query: vi.fn(), poll: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/cron/settings', () => ({ checkCronJobEnabled: mocks.gate }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/securityCompliance/amazonDeliveryPolling', () => ({ pollOnlineChannelDeliveryEvidence: mocks.poll }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';
const request = (authorized = true) => new Request('http://localhost/api/ims/channels/amazon/delivery/cron', {
  method: 'POST', headers: authorized ? { 'x-cron-secret': 'test-secret' } : {},
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'test-secret');
  mocks.gate.mockResolvedValue(null); mocks.query.mockResolvedValue([{ business_id: 'tenant-a' }]);
  mocks.poll.mockResolvedValue({ attempted: 1, delivered: 1, pending: 0, failed: 0, deferred: 0 }); mocks.report.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe('scheduled online-channel delivery evidence', () => {
  it('gates authentication and the master flag before any tenant or provider work', async () => {
    expect((await POST(request(false))).status).toBe(401);
    expect(mocks.gate).not.toHaveBeenCalled();
    mocks.gate.mockResolvedValueOnce(NextResponse.json({ skipped: true }));
    expect(await (await POST(request())).json()).toMatchObject({ skipped: true });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.poll).not.toHaveBeenCalled();
  });
  it('includes all IMS businesses without requiring a current channel registration, while respecting business pauses', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain('b.deleted_at IS NULL');
    expect(mocks.query.mock.calls[0][0]).toContain('automation_paused');
    expect(mocks.query.mock.calls[0][0]).toContain('b.has_ims = 1');
    expect(mocks.query.mock.calls[0][0]).toContain('OR b.ims_db_name IS NOT NULL');
    expect(mocks.query.mock.calls[0][0]).not.toContain('sales_channel_instances');
    expect(mocks.query.mock.calls[0][0]).not.toContain('instance.is_enabled');
    expect(mocks.poll).toHaveBeenCalledWith('tenant-a', expect.any(Map), expect.any(Number));
  });
  it('reports a partial operational failure, not HTTP 200 success', async () => {
    mocks.poll.mockResolvedValueOnce({ attempted: 1, delivered: 0, pending: 0, failed: 1, deferred: 0 });
    const response = await POST(request());
    expect(response.status).toBe(207); expect(await response.json()).toMatchObject({ success: false, failed: 1 });
  });
  it('reports tenant/schema failures with the correct business', async () => {
    mocks.poll.mockRejectedValueOnce(new Error('tenant schema unavailable'));
    expect((await POST(request())).status).toBe(207);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'poll_business' }));
  });
  it('fails visibly if the business list cannot be read', async () => {
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'scheduled_poll' }));
  });
});
