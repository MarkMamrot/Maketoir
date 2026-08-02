import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForesightCreativeBriefService } from '../ForesightCreativeBriefService';

const humanContext = { intendedAudience: 'Gift buyers', intendedMessage: 'Choose confidently', offer: 'Free wrapping', offlineContext: 'Window refresh' };
const document = {
  schemaVersion: 1, creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', title: 'Gift brief',
  hypothesis: 'Proof may improve qualified engagement.', audience: 'Gift buyers', singleMindedProposition: 'Choose confidently.',
  proofPoints: ['Free wrapping'], tone: ['Direct'], formats: [{ format: '4:5', placement: 'Feed', adaptationNotes: 'Keep proof visible.' }],
  variants: [{ id: 'control', change: 'Current', rationale: 'Baseline' }, { id: 'proof', change: 'Proof lead', rationale: 'Test one cue' }],
  testMatrix: [{ variantId: 'control', comparison: 'Current', primaryMetric: 'CTR', guardrails: ['conversion rate'] },
    { variantId: 'proof', comparison: 'Proof lead', primaryMetric: 'CTR', guardrails: ['conversion rate'] }],
  exclusions: ['No urgency'], successMetric: 'Platform CTR', stockOfferConstraints: ['Verify availability'],
  uncertainties: ['Diagnostic only'], humanContext, publishable: false,
};

function dependencies() {
  return {
    getCreative: vi.fn().mockResolvedValue({ id: 44, source: 'meta_ads', name: 'Gift ad' }),
    getThread: vi.fn().mockResolvedValue({ id: 12, revision: 3 }),
    getHumanContext: vi.fn().mockResolvedValue(humanContext),
    getAssessment: vi.fn().mockResolvedValue({ id: 9, evidence_mode: 'image', assessment_json: { structuredTags: ['product-led'] } }),
    listDiagnosticInputs: vi.fn().mockResolvedValue([]),
    getStrategy: vi.fn().mockResolvedValue({ id: 2, version: 2, strategy_json: { objective: 'Grow repeat' } }),
    getLatestBrief: vi.fn().mockResolvedValue(null),
    loadPrompt: vi.fn().mockResolvedValue({ version: 'creative-brief-v1', content: 'No causal claims.', sha256: 'a'.repeat(64) }),
    createVersion: vi.fn().mockResolvedValue({ id: 80, version: 1 }),
    reportIssue: vi.fn().mockResolvedValue(null),
  };
}

describe('ForesightCreativeBriefService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supplies governed evidence and persists exact immutable provenance', async () => {
    const deps = dependencies();
    const model = { generateJson: vi.fn().mockResolvedValue(document) };
    const service = createForesightCreativeBriefService(deps);

    await service.generate({ businessId: 'business-1', creativeId: 44, threadId: 12, expectedRevision: 3,
      diagnosticsThrough: '2026-08-01', actorUserId: 7, modelId: 'gemini', model });

    const prompt = JSON.parse(model.generateJson.mock.calls[0][0].prompt);
    expect(prompt).toMatchObject({ humanContext, requiredIdentity: { creativeId: 44, assessmentId: 9, publishable: false } });
    expect(prompt.diagnostics.authority).toBe('platform_diagnostic_non_causal');
    expect(deps.createVersion).toHaveBeenCalledWith('business-1', 12, 3, expect.objectContaining({
      creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext,
      promptVersion: 'creative-brief-v1', promptHash: 'a'.repeat(64), authoredBy: 7,
    }));
  });

  it('requires recorded human answers and a governed assessment before calling the model', async () => {
    const deps = dependencies();
    deps.getHumanContext.mockResolvedValue(null);
    const model = { generateJson: vi.fn() };
    const service = createForesightCreativeBriefService(deps);

    await expect(service.generate({ businessId: 'business-1', creativeId: 44, threadId: 12, expectedRevision: 3,
      diagnosticsThrough: '2026-08-01', actorUserId: 7, modelId: 'gemini', model }))
      .rejects.toThrow('Answer the Creative Review context questions');
    expect(model.generateJson).not.toHaveBeenCalled();
    expect(deps.createVersion).not.toHaveBeenCalled();
  });
});
