import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/rateRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/ai/billing/rateRepository')>();
  return { ...original, AiRateRepository: { ...original.AiRateRepository, savePlanPricing: mocks.save } };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = (settings: Record<string, unknown>) => new Request('http://localhost', { method: 'POST', body: JSON.stringify({ settings }) });

describe('AI plan markup admin route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin before saving plan pricing', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await POST(request({ starter: { pricingMode: 'markup', markupPercent: '25' } }))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects invalid percentages before writing', async () => {
    expect((await POST(request({ starter: { pricingMode: 'markup', markupPercent: '-5' } }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('saves validated plan pricing server-side', async () => {
    const settings = { starter: { pricingMode: 'markup', markupPercent: '50' }, core: { pricingMode: 'rates', markupPercent: '25.5' } };
    mocks.save.mockResolvedValue({ plans: 2 });
    const response = await POST(request(settings));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(settings);
  });

  it('reports database failures with safe aggregate context', async () => {
    mocks.save.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(request({ starter: { pricingMode: 'markup', markupPercent: '25' } }))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'save_plan_pricing', context: { plan_count: 1 } }));
  });
});