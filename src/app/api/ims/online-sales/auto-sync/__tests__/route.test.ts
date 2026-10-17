import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), control: vi.fn(), query: vi.fn(), imsQuery: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: async (_business: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/xero/onlineDailySalesSync', () => ({ syncOnlineDailySalesDay: vi.fn() }));
vi.mock('@/lib/xero/onlineBatchSyncState', () => ({
  getCompletedOnlineBatchKeys: vi.fn(), onlineBatchKey: vi.fn(),
}));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: vi.fn() }));
import { POST } from '../route';
describe('compatibility for already-open POS/IMS browser tabs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'alpha' });
    mocks.query.mockResolvedValue([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each(['validation', 'cutover'])('never imports history or posts accounting after %s, including when paused', async mode => {
    mocks.control.mockResolvedValue({ mode, paused: true });
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await (await POST(new Request('http://localhost/api/ims/online-sales/auto-sync'))).json())
      .toEqual({ skipped: true, reason: 'scheduled_recovery', paused: true });
    expect(mocks.session).toHaveBeenCalledWith(['marketoir_session', 'pos_session']);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.imsQuery).not.toHaveBeenCalled();
  });
  it('preserves inactive-business behavior', async () => {
    mocks.control.mockResolvedValue({ mode: 'legacy', paused: false });
    expect(await (await POST(new Request('http://localhost/api/ims/online-sales/auto-sync'))).json())
      .toEqual({ skipped: true, reason: 'setting_disabled' });
    expect(mocks.query).toHaveBeenCalled();
  });
  it('fails visibly rather than falling back to a historical scan when control fails', async () => {
    mocks.control.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(new Request('http://localhost/api/ims/online-sales/auto-sync'))).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledOnce();
  });
});
