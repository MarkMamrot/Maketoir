import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), set: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/cron/settings', () => ({ listCronJobSettings: mocks.list, setCronJobEnabled: mocks.set }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/admin/cron-jobs', { method: 'POST', body: JSON.stringify(body) });
}

describe('SuperAdmin Cron Jobs API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ user: { userId: 42, tier: 'SuperAdmin' } });
    mocks.list.mockResolvedValue([{ id: 'database-backup', enabled: true }]);
    mocks.set.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(null);
  });

  it('returns fresh master states for the catalogue', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ jobs: [{ id: 'database-backup', enabled: true }] });
  });

  it.each([true, false])('persists a confirmed change attributed to the verified SuperAdmin (%s)', async enabled => {
    const response = await POST(request({ jobId: 'database-backup', enabled, confirmed: true, userId: 999 }));
    expect(response.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith('database-backup', enabled, 42);
  });

  it.each([
    { jobId: 'unknown', enabled: false, confirmed: true },
    { jobId: 'database-backup', enabled: 'false', confirmed: true },
    { jobId: 'database-backup', enabled: false },
    null,
  ])('rejects invalid or unconfirmed changes without writes', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves the access guard (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Not authorised' }, { status }) });
    expect((await GET()).status).toBe(status);
    expect((await POST(request({ jobId: 'database-backup', enabled: false, confirmed: true }))).status).toBe(status);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('records save failures and returns an unsuccessful response', async () => {
    mocks.set.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(request({ jobId: 'database-backup', enabled: false, confirmed: true }))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set_cron_job', context: { jobId: 'database-backup', enabled: false, userId: 42 } }));
  });
});