import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ advance: vi.fn(), reconcile: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/ai/billing/repository', () => ({ AiBillingRepository: { advanceDueCycles: mocks.advance } }));
vi.mock('@/lib/ai/billing/reconciliation', () => ({ reconcileAiBilling: mocks.reconcile }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

function request(secret?: string) {
  return new Request('http://localhost/api/cron/ai-billing-maintenance', {
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('AI billing maintenance cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.advance.mockResolvedValue(1);
    mocks.reconcile.mockResolvedValue([]);
    mocks.report.mockResolvedValue(undefined);
  });

  it('accepts the redirect-safe cron header', async () => {
    const response = await GET(request('cron-secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cyclesAdvanced: 1, findings: 0 });
  });

  it('rejects an invalid cron header', async () => {
    expect((await GET(request('wrong'))).status).toBe(401);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it('reports route-wide maintenance failures', async () => {
    mocks.advance.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(request('cron-secret'));
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'maintenance' }));
  });
});