import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), control: vi.fn(), query: vi.fn(), execute: vi.fn(),
  instances: vi.fn(), instance: vi.fn(), request: vi.fn(), report: vi.fn(), tenant: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.tenant }));
vi.mock('@/lib/channels/onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness: mocks.instances, getForBusiness: mocks.instance },
}));
vi.mock('@/lib/channels/onlineRecoveryWorker', () => ({ requestOnlineRecovery: mocks.request }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, POST } from '../route';
import { OnlineSyncLeaseLostError } from '@/lib/channels/onlineSyncPolicy';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/online-sales/recovery', {
    method: 'POST', body: JSON.stringify(body),
  });
}
describe('tenant-scoped online recovery control', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'alpha', tier: 'Admin' });
    mocks.tenant.mockImplementation(async (_business: string, callback: () => Promise<unknown>) => callback());
    mocks.control.mockResolvedValue({ mode: 'cutover', paused: false, installed: true });
    mocks.instances.mockResolvedValue([]);
    mocks.instance.mockResolvedValue({ channelInstanceId: 'store', provider: 'shopify' });
    mocks.query.mockResolvedValue([]);
  });
  it('requires authentication for both reads and writes', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request({ action: 'retry' }))).status).toBe(401);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it('allows Advisor status reads but not mutation', async () => {
    mocks.session.mockResolvedValue({ businessId: 'alpha', tier: 'Advisor' });
    expect((await GET()).status).toBe(200);
    expect((await POST(request({ action: 'pause' }))).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not read unmigrated recovery tables or activate a legacy business', async () => {
    mocks.control.mockResolvedValue({ mode: 'legacy', paused: false, installed: false });
    expect(await (await GET()).json()).toMatchObject({ mode: 'legacy', channels: [] });
    expect((await POST(request({ action: 'retry' }))).status).toBe(409);
    expect(mocks.instances).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['activate', 'cutover', 'clear_review', 'force_ready'])('rejects unsupported action %s', async action => {
    expect((await POST(request({ action }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('checks exact business ownership before retrying a selected storefront', async () => {
    mocks.instance.mockResolvedValue(null);
    expect((await POST(request({ action: 'retry', channelInstanceId: 'foreign' }))).status).toBe(404);
    expect(mocks.instance).toHaveBeenCalledWith('alpha', 'foreign');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('persists pause without restoring legacy mode', async () => {
    expect(await (await POST(request({ action: 'pause' }))).json()).toEqual({ queued: false, paused: true });
    expect(mocks.execute.mock.calls[0][0]).toContain('SET paused = ?');
    expect(mocks.execute.mock.calls[0][0]).not.toContain('SET rollout_state');
    expect(mocks.execute.mock.calls[0][1]).toEqual([1, 'alpha']);
  });
  it('queues durable work before reporting retry, clears only the job block, and preserves live leases', async () => {
    expect((await POST(request({ action: 'retry', channelInstanceId: 'store' }))).status).toBe(200);
    expect(mocks.request).toHaveBeenCalledWith('alpha', 'store');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain("JSON_REMOVE(payload_json,'$.blockedReason')");
    expect(sql).toContain("<> 'historical_scope_paused'");
    expect(sql).toContain("status = 'processing' AND lease_expires_at <= UTC_TIMESTAMP(3)");
    expect(sql).not.toContain('review_reason');
    expect(params).toEqual(['alpha', 'store']);
  });
  it('reports explicit recovery/accounting scope and held historical work separately', async () => {
    mocks.instances.mockResolvedValue([{
      channelInstanceId: 'store', provider: 'shopify', displayName: 'Shop',
      settings: { shopify: { xero: { dailyAccountingFrom: '2026-10-18' } } },
    }]);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('ims_shopify_reconciliation')) return [{ baseline_from: '2026-10-10T00:00:00Z', baseline_complete: 1 }];
      if (sql.includes('AS pending')) return [{ pending: 1, failed: 0, held: 107 }];
      if (sql.includes('COUNT(*)')) return [{ total: 0 }];
      return [];
    });
    expect(await (await GET()).json()).toMatchObject({ channels: [{
      recoveryFrom: '2026-10-10T00:00:00Z', accountingFrom: '2026-10-18', heldHistoricalJobs: 107,
      pendingJobs: 1, failedJobs: 0,
    }] });
  });
  it('requires resume rather than claiming to retry paused work', async () => {
    mocks.control.mockResolvedValue({ mode: 'cutover', paused: true, installed: true });
    expect((await POST(request({ action: 'retry' }))).status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('surfaces operational failure without exposing the raw provider/customer error', async () => {
    mocks.request.mockRejectedValue(new Error('private customer payload'));
    expect((await POST(request({ action: 'retry' }))).status).toBe(503);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'alpha' }));
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('private customer payload');
  });
  it('surfaces the main automation pause as an expected conflict, not an operational failure', async () => {
    mocks.request.mockRejectedValue(new OnlineSyncLeaseLostError());
    expect((await POST(request({ action: 'retry' }))).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
