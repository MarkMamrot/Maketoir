import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), get: vi.fn(), settings: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.guard }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({
  getXeroReconciliationRecipients: mocks.get, getXeroReconciliationEmailSettings: mocks.settings,
  saveXeroReconciliationRecipients: mocks.save,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, PUT } from '../route';
const request = (recipients: unknown) => new Request('http://localhost/api/ims/settings/accounts', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients, businessId: 'wrong-business' }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockReturnValue({ user: { businessId: 'business-1', tier: 'Admin' } });
  mocks.get.mockResolvedValue(['accounts@example.com']);
  mocks.settings.mockResolvedValue({ digestFrequency: 'off' });
});
describe('shared accounts recipients settings', () => {
  it('loads existing configured recipients scoped to the signed-in business', async () => {
    expect(await (await GET()).json()).toEqual({ recipients: ['accounts@example.com'] });
    expect(mocks.get).toHaveBeenCalledWith('business-1');
  });
  it('updates the existing shared recipient list only, without altering digest scheduling', async () => {
    expect((await PUT(request(' ACCOUNTS@example.com; accounts@example.com, books@example.com '))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ businessId: 'business-1', recipients: ['accounts@example.com', 'books@example.com'] });
  });
  it.each(['not-an-email', Array.from({ length: 21 }, (_, i) => `accounts${i}@example.com`)])('rejects invalid or excessive recipients', async recipients => {
    expect((await PUT(request(recipients))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not allow empty recipients while scheduled digest is on', async () => {
    mocks.settings.mockResolvedValue({ digestFrequency: 'daily' });
    expect((await PUT(request(''))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('allows clearing when scheduled digests are off', async () => {
    expect((await PUT(request(''))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ businessId: 'business-1', recipients: [] });
  });
  it('requires admin access for loading and saving', async () => {
    mocks.guard.mockReturnValue({ response: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect((await PUT(request('accounts@example.com'))).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('reports failed persistence and does not return success', async () => {
    mocks.save.mockRejectedValue(new Error('DB failed'));
    expect((await PUT(request('accounts@example.com'))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'save_recipients' }));
  });
});
