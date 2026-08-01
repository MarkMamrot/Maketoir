import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getThread: vi.fn(), listMessages: vi.fn(), listThreadLinks: vi.fn(), listThreadFacts: vi.fn(),
  latestPlanVersion: vi.fn(), createPlanVersion: vi.fn(), recordValidation: vi.fn(),
  loadPrompt: vi.fn(), report: vi.fn(),
}));

vi.mock('../repositories/ForesightPlanningRepository', () => ({
  PlanningThreadConflictError: class PlanningThreadConflictError extends Error {},
  PlanReviewTransitionError: class PlanReviewTransitionError extends Error {},
  ForesightPlanningRepository: {
    getThread: mocks.getThread, listMessages: mocks.listMessages, listThreadLinks: mocks.listThreadLinks,
    listThreadFacts: mocks.listThreadFacts, latestPlanVersion: mocks.latestPlanVersion,
    createPlanVersion: mocks.createPlanVersion, recordValidation: mocks.recordValidation,
  },
}));
vi.mock('../prompts/promptManifest', () => ({ loadForesightPrompt: mocks.loadPrompt }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { ForesightPlanDraftingService, PlanDraftRejectedError } from '../assistant/ForesightPlanDraftingService';

const fact = {
  factId: 'fact-1', label: 'Revenue', source: 'IMS', authority: 'authoritative' as const,
  observedFrom: '2026-07-01', observedThrough: '2026-07-31', freshnessAt: '2026-08-01',
  quality: { grade: 'good' }, value: { revenue: 100 },
};
const plan = {
  schemaVersion: 1, title: 'Growth plan', objective: 'Grow profitable revenue.', planningHorizon: '30 days',
  strategyVersion: null, recommendationIds: [], humanGoals: ['Profitable growth'], targetAudiences: ['Customers'], constraints: [],
  citations: [{ factId: fact.factId, source: fact.source, authority: fact.authority, observedFrom: fact.observedFrom, observedThrough: fact.observedThrough }],
  statements: [{ kind: 'fact', text: 'Revenue is measured.', citationFactIds: [fact.factId] }], questions: [],
  options: [{ id: 'focused', title: 'Focused plan', summary: 'Focus activity.', benefits: ['Clarity'], risks: ['Narrow reach'], evidenceRequired: [] }],
  selectedOptionId: 'focused', actions: [{ id: 'review', title: 'Review the plan', actionType: 'human_review', owner: 'ai_draft', executable: false, rationale: 'Human decision required.', dependencies: [] }],
  successMetrics: ['Profitable revenue grows'], guardrails: ['Human approval required'],
  monitoringPlan: { reviewDate: '2026-08-08', stopConditions: ['Margin declines'] }, confidence: 0.7,
};

describe('ForesightPlanDraftingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getThread.mockResolvedValue({ id: 12, revision: 3, thread_type: 'initiative', title: 'Growth plan' });
    mocks.listMessages.mockResolvedValue([{ actor_type: 'human', content: 'Grow profitably.' }]);
    mocks.listThreadLinks.mockResolvedValue([]);
    mocks.listThreadFacts.mockResolvedValue([fact]);
    mocks.latestPlanVersion.mockResolvedValue(null);
    mocks.loadPrompt.mockResolvedValue({ version: 'initiative-planner-v1', content: 'Governed prompt', sha256: 'hash' });
    mocks.createPlanVersion.mockResolvedValue({ id: 50, version: 1, planHash: 'plan-hash', markdown: '# Growth plan', threadRevision: 4 });
    mocks.recordValidation.mockResolvedValue(60);
  });

  it('rejects unknown audited citations before creating a plan version', async () => {
    const invented = { ...plan, citations: [{ ...plan.citations[0], factId: 'invented' }], statements: [{ kind: 'fact', text: 'Invented.', citationFactIds: ['invented'] }] };
    const model = { generateJson: vi.fn().mockResolvedValue(invented) };

    await expect(ForesightPlanDraftingService.draft({
      businessId: 'business-1', threadId: 12, expectedRevision: 3, actorUserId: 7,
      modelId: 'gemini-2.5-flash', model,
    })).rejects.toBeInstanceOf(PlanDraftRejectedError);

    expect(mocks.createPlanVersion).not.toHaveBeenCalled();
    expect(mocks.recordValidation).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('persists a valid immutable plan and its deterministic validation', async () => {
    const model = { generateJson: vi.fn().mockResolvedValue(plan) };
    const result = await ForesightPlanDraftingService.draft({
      businessId: 'business-1', threadId: 12, expectedRevision: 3, actorUserId: 7,
      modelId: 'gemini-2.5-flash', model,
    });

    expect(mocks.createPlanVersion).toHaveBeenCalledWith('business-1', 12, 3, expect.objectContaining({
      plan: expect.objectContaining({ title: 'Growth plan' }), state: 'ready_for_validation', authoredBy: 7,
      modelId: 'gemini-2.5-flash', promptVersion: 'initiative-planner-v1',
      toolManifestVersion: 'foresight-planner-tools-v4',
    }));
    expect(mocks.recordValidation).toHaveBeenCalledWith('business-1', expect.objectContaining({
      planVersionId: 50, planHash: 'plan-hash', state: 'passed', validatorVersion: 'foresight-plan-validator-v1',
    }));
    expect(result).toMatchObject({ planVersionId: 50, validationId: 60, validation: { state: 'passed' } });
  });
});