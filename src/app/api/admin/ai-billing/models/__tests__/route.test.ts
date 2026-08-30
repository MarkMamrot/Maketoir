import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), setAllowed: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/rateRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/ai/billing/rateRepository')>();
  return { ...original, AiRateRepository: { ...original.AiRateRepository, setModelAllowed: mocks.setAllowed } };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { PATCH } from '../route';

const request = (body: unknown) => new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) });

describe('AI provider model admin route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin before changing model availability', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await PATCH(request({ modelId: 'gemini-2.5-pro', allowed: true }))).status).toBe(403);
    expect(mocks.setAllowed).not.toHaveBeenCalled();
  });

  it('validates and forwards model availability', async () => {
    expect((await PATCH(request({ modelId: ' gemini-2.5-pro ', allowed: false }))).status).toBe(200);
    expect(mocks.setAllowed).toHaveBeenCalledWith('gemini-2.5-pro', false);
    expect((await PATCH(request({ modelId: '', allowed: true }))).status).toBe(400);
  });

  it('reports failures with safe model context', async () => {
    mocks.setAllowed.mockRejectedValue(new Error('database unavailable'));
    expect((await PATCH(request({ modelId: 'gemini-2.5-pro', allowed: true }))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set_allowed_provider_model', context: { model_id: 'gemini-2.5-pro', allowed: true } }));
  });
});