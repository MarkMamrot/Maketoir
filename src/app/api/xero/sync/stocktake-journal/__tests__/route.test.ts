import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), advisor: vi.fn(), policy: vi.fn(), disabled: vi.fn(),
  sync: vi.fn(), tenant: vi.fn(), notify: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.auth, assertBusinessAccess: mocks.access }));
vi.mock('@/lib/xero/advisorSyncAccess', () => ({ getXeroSyncAccessDenied: mocks.advisor }));
vi.mock('@/lib/xero/postingPolicy', () => ({ assertXeroWorkflowEnabled: mocks.policy, isXeroPolicyDisabledError: mocks.disabled }));
vi.mock('@/services/XeroSyncService', () => ({ syncStocktakeJournal: mocks.sync }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.tenant }));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: mocks.notify }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';

const request = (automatic?: boolean) => new Request('http://localhost/api/xero/sync/stocktake-journal', {
  method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', stocktakeId: 31, automatic }),
});

describe('stocktake Xero posting intent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { tier: 'Admin' } });
    mocks.tenant.mockImplementation(async (_businessId, callback) => callback());
    mocks.sync.mockResolvedValue({ journalId: 'journal-1', lines: 2, totalValue: 40 });
  });

  it.each(['xero_accounting_disabled', 'xero_posting_disabled', 'xero_workflow_disabled'])('quietly skips automatic completion for %s', async code => {
    mocks.policy.mockRejectedValue(Object.assign(new Error('Disabled'), { code, status: 423 }));
    mocks.disabled.mockReturnValue(true);
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: true, code });
    expect(mocks.policy).toHaveBeenCalledWith('biz-1', 'stocktakeJournalEnabled');
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('still explicitly rejects a manual sync when posting is disabled', async () => {
    mocks.policy.mockRejectedValue(Object.assign(new Error('Paused'), { code: 'xero_posting_disabled', status: 423 }));
    mocks.disabled.mockReturnValue(true);
    expect((await POST(request())).status).toBe(423);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('posts permitted stocktake adjustments in the correct tenant context', async () => {
    const response = await POST(request(true));
    expect(await response.json()).toMatchObject({ ok: true, journalId: 'journal-1', lines: 2 });
    expect(mocks.tenant).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.sync).toHaveBeenCalledWith('biz-1', 31);
  });

  it('reports intended-but-disconnected posting instead of silently skipping it', async () => {
    mocks.sync.mockRejectedValue(new Error('No Xero connection found for this business.'));
    const response = await POST(request(true));
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ error: 'No Xero connection found for this business.' });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', detail: expect.objectContaining({ stocktake_id: 31 }),
    }));
  });

  it('does not evaluate posting rules or sync another business when access is denied', async () => {
    mocks.access.mockReturnValue(new Response('{}', { status: 403 }));
    expect((await POST(request(true))).status).toBe(403);
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('records a Runtime Issue if the failure notification cannot be saved', async () => {
    mocks.sync.mockRejectedValue(new Error('Xero disconnected'));
    mocks.notify.mockRejectedValue(new Error('Notification unavailable'));
    const response = await POST(request(true));
    expect(await response.json()).toMatchObject({ error: 'Xero disconnected' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'notify_sync_failure',
      context: expect.objectContaining({ stocktake_id: 31 }),
    }));
  });
});
