import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acceptedPlan: vi.fn(), latest: vi.fn(), createVersion: vi.fn(), listFacts: vi.fn(), loadPrompt: vi.fn(), report: vi.fn(),
}));
vi.mock('../repositories/ForesightDeliverableRepository', () => ({
  DeliverableTransitionError: class DeliverableTransitionError extends Error {},
  ForesightDeliverableRepository: {
    acceptedPlan: mocks.acceptedPlan, latest: mocks.latest, createVersion: mocks.createVersion,
  },
}));
vi.mock('../repositories/ForesightPlanningRepository', () => ({
  ForesightPlanningRepository: { listThreadFacts: mocks.listFacts },
}));
vi.mock('../prompts/promptManifest', () => ({ loadForesightPrompt: mocks.loadPrompt }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { ForesightDeliverableService } from '../assistant/ForesightDeliverableService';

const validDocument = {
  schemaVersion: 1, title: 'Campaign', planVersionId: 41, planHash: 'a'.repeat(64), objective: 'Grow.', audience: [],
  productSelection: [], offerConstraints: [], creativeDirection: [], assets: [{ id: 'brief', channel: 'campaign_brief',
    assetType: 'brief', title: 'Brief', content: 'Draft.', publishable: false, claims: [], reviewNotes: [] }],
  trackingRequirements: [], successMetrics: [], guardrails: [], reviewDate: null, stopConditions: [],
};

describe('ForesightDeliverableService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptedPlan.mockResolvedValue({
      id: 41, plan_hash: 'a'.repeat(64),
      plan_json: { citations: [{ factId: 'accepted-fact' }], title: 'Accepted plan' },
    });
    mocks.latest.mockResolvedValue(null);
    mocks.listFacts.mockResolvedValue([{ factId: 'accepted-fact', value: { revenue: 100 } }, { factId: 'other-fact', value: { revenue: 999 } }]);
    mocks.loadPrompt.mockResolvedValue({ version: 'campaign-deliverables-v1', content: 'Prompt' });
    mocks.createVersion.mockResolvedValue({ id: 80, version: 1 });
  });

  it('supplies only accepted-plan facts and persists immutable provenance', async () => {
    const model = { generateJson: vi.fn().mockResolvedValue(validDocument) };
    await ForesightDeliverableService.generate({
      businessId: 'business-1', threadId: 12, actorUserId: 7, modelId: 'gemini', model,
      channels: ['campaign_brief', 'meta'],
    });

    const payload = JSON.parse(model.generateJson.mock.calls[0][0].prompt);
    expect(payload.auditedFacts).toEqual([{ factId: 'accepted-fact', value: { revenue: 100 } }]);
    expect(mocks.createVersion).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({
      planVersionId: 41, planHash: 'a'.repeat(64), knownFactIds: ['accepted-fact'],
      modelId: 'gemini', promptVersion: 'campaign-deliverables-v1', authoredBy: 7,
    }));
  });

  it('does not persist a model attempt to make an asset publishable', async () => {
    const model = { generateJson: vi.fn().mockResolvedValue({
      ...validDocument, assets: [{ ...validDocument.assets[0], publishable: true }],
    }) };
    mocks.createVersion.mockImplementation(async (_businessId, _threadId, input) => {
      const { parseForesightDeliverableDocument } = await import('../planning/deliverableDocument');
      parseForesightDeliverableDocument(input.document, {
        planVersionId: input.planVersionId, planHash: input.planHash, knownFactIds: input.knownFactIds,
      });
    });

    await expect(ForesightDeliverableService.generate({
      businessId: 'business-1', threadId: 12, actorUserId: 7, modelId: 'gemini', model, channels: ['campaign_brief'],
    })).rejects.toThrow('Invalid Foresight deliverable document');
    expect(mocks.report).not.toHaveBeenCalled();
  });
});