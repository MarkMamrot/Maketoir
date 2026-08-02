import { describe, expect, it, vi } from 'vitest';
import { createForesightCreativeAssessmentService } from '../ForesightCreativeAssessmentService';

const creative = {
  id: 44, business_id: 'business-1', source: 'meta_ads' as const, account_id: '123', external_id: '999',
  creative_kind: 'creative' as const, name: 'Winter range', format: 'VIDEO', status: 'ACTIVE',
  copy_json: { body: 'Warm up' }, media_json: { videoId: '55' }, first_seen_on: '2026-08-01', last_seen_on: '2026-08-02',
};
const assessment = {
  schemaVersion: 1, factualDescription: 'A short product video with winter-range copy.', structuredTags: ['product-led'],
  brandFitObservations: ['The direct wording matches the configured direct tone.'], accessibilityIssues: [],
  compositionTraits: ['single focal product'], formatTraits: ['video'], uncertainties: [], confidence: 0.8,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getCreative: vi.fn().mockResolvedValue(creative),
    getBrandProfile: vi.fn().mockResolvedValue({ mission: 'Useful gifts', uvp: null, tone: 'Direct', hero_products: null,
      price_positioning: null, brand_colours: 'red', detailed_brand_aesthetic: 'Clean', praises: null, objections: null }),
    getConnection: vi.fn(),
    loadPrompt: vi.fn().mockResolvedValue({ id: 'creative-assessment', version: 'creative-assessment-v1', content: 'Governed', sha256: 'a'.repeat(64) }),
    saveAssessment: vi.fn(async (value) => ({ id: 7, created_at: '2026-08-03', ...value })),
    resolveMedia: vi.fn().mockResolvedValue({ url: 'https://platform.example/frame.jpg', mediaType: 'video_frame' }),
    fetchMedia: vi.fn().mockResolvedValue({ mimeType: 'image/jpeg', data: 'base64', mode: 'video_frame' }),
    reportIssue: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

describe('ForesightCreativeAssessmentService', () => {
  it('assesses server-loaded creative and brand evidence with immutable provenance', async () => {
    const deps = dependencies();
    const model = { generateJson: vi.fn().mockResolvedValue(assessment) };
    const service = createForesightCreativeAssessmentService(deps);

    const result = await service.assess({ businessId: 'business-1', creativeId: 44, actorUserId: 8, modelId: 'gemini-test', model });

    expect(deps.getCreative).toHaveBeenCalledWith('business-1', 44);
    expect(model.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gemini-test', media: { mimeType: 'image/jpeg', data: 'base64', mode: 'video_frame' },
    }));
    const prompt = JSON.parse(model.generateJson.mock.calls[0][0].prompt);
    expect(prompt).toMatchObject({ evidenceMode: 'video_frame', creative: { id: 44, copy: { body: 'Warm up' } }, brandProfile: { tone: 'Direct' } });
    expect(JSON.stringify(prompt)).not.toContain('business-1');
    expect(deps.saveAssessment).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'business-1', creative_id: 44,
      evidence_mode: 'video_frame', prompt_version: 'creative-assessment-v1', assessment_json: assessment }));
    expect(result.assessment_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('degrades failed media retrieval to explicit text-only evidence', async () => {
    const deps = dependencies({ fetchMedia: vi.fn().mockRejectedValue(new Error('blocked URL')) });
    const model = { generateJson: vi.fn().mockResolvedValue({ ...assessment, uncertainties: ['No image pixels were available.'], confidence: 0.5 }) };
    const service = createForesightCreativeAssessmentService(deps);

    await service.assess({ businessId: 'business-1', creativeId: 44, actorUserId: 8, modelId: 'gemini-test', model });

    expect(model.generateJson).toHaveBeenCalledWith(expect.objectContaining({ media: null }));
    expect(JSON.parse(model.generateJson.mock.calls[0][0].prompt).evidenceMode).toBe('text_only');
    expect(deps.saveAssessment).toHaveBeenCalledWith(expect.objectContaining({ evidence_mode: 'text_only' }));
  });

  it('reports malformed model output and never persists it', async () => {
    const deps = dependencies();
    const model = { generateJson: vi.fn().mockResolvedValue({ ...assessment, confidence: 4 }) };
    const service = createForesightCreativeAssessmentService(deps);

    await expect(service.assess({ businessId: 'business-1', creativeId: 44, actorUserId: 8, modelId: 'gemini-test', model }))
      .rejects.toThrow('assessment.confidence must be between 0 and 1');
    expect(deps.saveAssessment).not.toHaveBeenCalled();
    expect(deps.reportIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'assess_creative' }));
  });
});
