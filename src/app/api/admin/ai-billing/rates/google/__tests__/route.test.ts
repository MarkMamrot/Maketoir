import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), compare: vi.fn(), importRates: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/modelCatalogSync', () => ({ refreshGoogleModelCatalog: async () => ({ preview: await mocks.preview() }) }));
vi.mock('@/lib/ai/billing/rateRepository', () => ({ AiRateRepository: { compareGoogle: mocks.compare, importGoogle: mocks.importRates } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

describe('Google AI rates admin route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin before contacting Google', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('re-fetches Google and imports only selected server candidates', async () => {
    mocks.preview.mockResolvedValue({ fetchedAt: 'now', candidates: [{ id: 'a' }, { id: 'b' }], warnings: [] });
    mocks.importRates.mockResolvedValue({ imported: 1, skipped: 0 });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ candidateIds: ['b'] }) }));
    expect(response.status).toBe(200);
    expect(mocks.importRates).toHaveBeenCalledWith([{ id: 'b' }], 7);
  });

  it('reports provider failures without exposing credentials', async () => {
    mocks.preview.mockRejectedValue(new Error('permission denied'));
    expect((await GET()).status).toBe(503);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'preview_google_ai_rates' }));
  });
});