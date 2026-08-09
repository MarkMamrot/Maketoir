import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, assertBusinessAccess: mocks.access }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ getXeroReconciliationEmailSettings: mocks.get, saveXeroReconciliationEmailSettings: mocks.save }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PUT } from '../route';

describe('/api/xero/reconciliation/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Admin' } });
    mocks.access.mockReturnValue(null);
    mocks.get.mockResolvedValue({ recipients: ['accounts@example.com'], digestFrequency: 'off', digestTimeZone: 'Australia/Sydney', digestHour: 8, digestWeeklyDay: 1, lastDigestCompletedAt: null });
    mocks.save.mockResolvedValue(undefined);
  });

  it('allows Advisor to read recipients but not change them', async () => {
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    expect((await GET(new Request('http://localhost/api/xero/reconciliation/settings?databaseId=biz-1'))).status).toBe(200);
    const response = await PUT(new Request('http://localhost/api/xero/reconciliation/settings', {
      method: 'PUT', body: JSON.stringify({ databaseId: 'biz-1', recipients: ['accounts@example.com'] }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('normalizes Admin recipient updates and rejects malformed addresses', async () => {
    const response = await PUT(new Request('http://localhost/api/xero/reconciliation/settings', {
      method: 'PUT', body: JSON.stringify({ databaseId: 'biz-1', recipients: ' Accounts@Example.com;owner@example.com ' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({
      businessId: 'biz-1', recipients: ['accounts@example.com', 'owner@example.com'],
      digestFrequency: 'off', digestTimeZone: 'Australia/Sydney', digestHour: 8, digestWeeklyDay: 1,
    });

    const invalid = await PUT(new Request('http://localhost/api/xero/reconciliation/settings', {
      method: 'PUT', body: JSON.stringify({ databaseId: 'biz-1', recipients: 'not-an-email' }),
    }));
    expect(invalid.status).toBe(400);
  });

  it('requires recipients and valid schedule fields when enabling a digest', async () => {
    const missingRecipient = await PUT(new Request('http://localhost/api/xero/reconciliation/settings', {
      method: 'PUT', body: JSON.stringify({ databaseId: 'biz-1', recipients: '', digestFrequency: 'daily', digestTimeZone: 'Australia/Sydney', digestHour: 8 }),
    }));
    expect(missingRecipient.status).toBe(400);

    const invalidTimeZone = await PUT(new Request('http://localhost/api/xero/reconciliation/settings', {
      method: 'PUT', body: JSON.stringify({ databaseId: 'biz-1', recipients: 'accounts@example.com', digestFrequency: 'weekly', digestTimeZone: 'Mars/Olympus', digestHour: 8, digestWeeklyDay: 1 }),
    }));
    expect(invalidTimeZone.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});