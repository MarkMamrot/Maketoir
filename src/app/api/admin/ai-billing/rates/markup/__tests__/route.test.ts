import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), apply: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/rateRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/ai/billing/rateRepository')>();
  return { ...original, AiRateRepository: { ...original.AiRateRepository, applyPlanMarkups: mocks.apply } };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = (markups: Record<string, string>) => new Request('http://localhost', { method: 'POST', body: JSON.stringify({ markups }) });

describe('AI plan markup admin route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin before applying markups', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await POST(request({ starter: '25' }))).status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('rejects invalid percentages before writing', async () => {
    expect((await POST(request({ starter: '-5' }))).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('applies validated plan percentages server-side', async () => {
    mocks.apply.mockResolvedValue({ plans: 2, rates: 76, providerRates: 38 });
    const response = await POST(request({ starter: '50', core: '25.5', scale: '' }));
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith({ starter: '50', core: '25.5', scale: '' }, 7);
  });

  it('reports database failures with safe aggregate context', async () => {
    mocks.apply.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(request({ starter: '25' }))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'apply_plan_rate_markups', context: { plan_count: 1 } }));
  });
});