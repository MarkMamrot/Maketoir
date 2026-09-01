import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/curatedPricingRepository', () => ({ CuratedPricingRepository: { get: mocks.get, save: mocks.save } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

describe('curated AI pricing route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin access', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('saves FX, model costs, and tier markups through one repository call', async () => {
    mocks.save.mockResolvedValue({ models: 6, plans: 5, updatedModels: 6 });
    const body = { audPerUsd: '1.52', markups: { starter: '20', core: '18', scale: '15', enterprise: '10', platform: '0' } };
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(body, 7);
  });

  it('returns validation failures without recording an operational issue', async () => {
    mocks.save.mockRejectedValue(new Error('Enter a markup for starter.'));
    const response = await POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});