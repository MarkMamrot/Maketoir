import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), load: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session }));
vi.mock('@/lib/foresight/repositories/ForesightCreativeRepository', () => ({ ForesightCreativeRepository: { get: mocks.get } }));
vi.mock('@/lib/foresight/creative/ForesightCreativeAssessmentService', () => ({ loadCreativeMediaEvidence: mocks.load }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';
const context = { params: { creativeId: '44' } };

describe('Creative Review media route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'business-1' } });
    mocks.get.mockResolvedValue({ id: 44, source: 'meta_ads' });
    mocks.report.mockResolvedValue(null);
  });

  it('returns only server-resolved bounded media for a tenant creative', async () => {
    mocks.load.mockResolvedValue({ mimeType: 'image/png', data: Buffer.from('image').toString('base64'), mode: 'image' });
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.get).toHaveBeenCalledWith('business-1', 44);
    expect(mocks.load).toHaveBeenCalledWith('business-1', { id: 44, source: 'meta_ads' });
  });

  it('reports operational media failures without exposing platform errors', async () => {
    mocks.load.mockRejectedValue(new Error('signed URL failed with secret detail'));
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Creative media is temporarily unavailable.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'load_creative_media' }));
  });
});
