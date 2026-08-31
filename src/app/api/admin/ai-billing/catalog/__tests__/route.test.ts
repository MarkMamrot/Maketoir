import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), sync: vi.fn(), map: vi.fn(), deactivate: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/ai/billing/modelCatalogSync', () => ({ refreshGoogleModelCatalog: mocks.sync }));
vi.mock('@/lib/ai/billing/modelCatalogRepository', () => ({ AiModelCatalogRepository: { list: mocks.list, saveMapping: mocks.map, deactivateMapping: mocks.deactivate } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH, POST } from '../route';

const request = (body: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });

describe('AI model catalog admin route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ user: { userId: 7 } }); });

  it('requires SuperAdmin before reading reconciliation data', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('runs canonical discovery without activating rates', async () => {
    mocks.sync.mockResolvedValue({ discovered: 63, observed: 610 });
    const response = await POST(request({ action: 'discover' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ discovered: 63, observed: 610 }));
  });

  it('validates and audits a manual family mapping through the repository', async () => {
    mocks.map.mockResolvedValue({ id: 12 });
    const response = await POST(request({ action: 'map', modelId: 'gemini-new', familyPattern: 'Gemini New', matchType: 'contains' }));
    expect(response.status).toBe(200);
    expect(mocks.map).toHaveBeenCalledWith({ modelId: 'gemini-new', familyPattern: 'Gemini New', matchType: 'contains' }, 7);
  });

  it('deactivates mappings by validated ID', async () => {
    const response = await PATCH(request({ mappingId: 12 }));
    expect(response.status).toBe(200);
    expect(mocks.deactivate).toHaveBeenCalledWith(12, 7);
  });
});