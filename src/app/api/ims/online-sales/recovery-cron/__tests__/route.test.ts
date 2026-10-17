import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cron: vi.fn(), worker: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/cron/settings', () => ({ checkCronJobEnabled: mocks.cron }));
vi.mock('@/lib/channels/onlineRecoveryWorker', () => ({ runOnlineRecoveryDispatch: mocks.worker }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';
function request(secret = 'test-secret') {
  return new Request('http://localhost/api/ims/online-sales/recovery-cron', {
    method: 'POST', headers: { 'x-cron-secret': secret },
  });
}
describe('scheduled online recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mocks.cron.mockResolvedValue(null);
    mocks.worker.mockResolvedValue({ failed: 0, jobs: 1, processed: 25, businesses: 1 });
  });
  it.each(['', 'wrong', 'same-length'])('rejects invalid secret %s before doing work', async secret => {
    expect((await POST(request(secret))).status).toBe(401);
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it('honors Cron Jobs pause without running the worker', async () => {
    mocks.cron.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await POST(request())).status).toBe(200);
    expect(mocks.cron).toHaveBeenCalledWith('online-recovery');
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it('does not report partial failures as a successful scheduler run', async () => {
    mocks.worker.mockResolvedValue({ failed: 1, jobs: 1, processed: 0, businesses: 1 });
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false });
  });
  it('records dispatcher failure visibly', async () => {
    mocks.worker.mockRejectedValue(new Error('private'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('private');
  });
  it('records an unavailable Cron gate rather than running without its pause control', async () => {
    mocks.cron.mockRejectedValue(new Error('gate unavailable'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledOnce();
  });
});
