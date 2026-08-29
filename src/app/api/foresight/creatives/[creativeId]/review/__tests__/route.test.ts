import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), tier: vi.fn(), get: vi.fn(), assessment: vi.fn(), diagnosticInputs: vi.fn(),
  getThread: vi.fn(), messages: vi.fn(), humanContext: vi.fn(), latest: vi.fn(), start: vi.fn(), recordContext: vi.fn(),
  latestReview: vi.fn(), review: vi.fn(), generate: vi.fn(), gateway: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, requireAdminTier: mocks.tier }));
vi.mock('@/lib/foresight/repositories/ForesightCreativeRepository', () => ({ ForesightCreativeRepository: {
  get: mocks.get, latestAssessment: mocks.assessment, listDiagnosticInputs: mocks.diagnosticInputs,
} }));
vi.mock('@/lib/foresight/repositories/ForesightCreativeBriefRepository', () => ({
  CreativeBriefTransitionError: class CreativeBriefTransitionError extends Error {},
  ForesightCreativeBriefRepository: { getThread: mocks.getThread, listMessages: mocks.messages,
    latestHumanContext: mocks.humanContext, latest: mocks.latest, getOrCreateReviewThread: mocks.start,
    latestReview: mocks.latestReview, recordHumanContext: mocks.recordContext, review: mocks.review },
}));
vi.mock('@/lib/foresight/repositories/ForesightPlanningRepository', () => ({
  PlanningThreadConflictError: class PlanningThreadConflictError extends Error {},
}));
vi.mock('@/lib/foresight/creative/ForesightCreativeBriefService', () => ({ ForesightCreativeBriefService: { generate: mocks.generate } }));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({ createGeminiPlannerModelGateway: mocks.gateway }));

import { GET, POST } from '../route';

const context = { params: { creativeId: '44' } };

describe('Creative Review route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const user = { businessId: 'business-1', userId: 7 };
    mocks.session.mockReturnValue({ user });
    mocks.tier.mockReturnValue({ user });
    mocks.get.mockResolvedValue({ id: 44, name: 'Gift ad' });
    mocks.assessment.mockResolvedValue({ id: 9 });
    mocks.diagnosticInputs.mockResolvedValue([]);
    mocks.getThread.mockResolvedValue(null);
    mocks.latest.mockResolvedValue(null);
    mocks.messages.mockResolvedValue([]);
    mocks.humanContext.mockResolvedValue(null);
    mocks.latestReview.mockResolvedValue(null);
    mocks.gateway.mockReturnValue({ generateJson: vi.fn() });
    vi.stubEnv('GEMINI_API_KEY', 'server-key');
    vi.stubEnv('FORESIGHT_CREATIVE_MODEL', 'gemini-creative');
  });

  it('loads only session-tenant evidence and an explicit diagnostic window', async () => {
    const response = await GET(new Request('http://localhost/api/foresight/creatives/44/review?through=2026-08-01&businessId=other'), context);
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith('business-1', 44);
    expect(mocks.diagnosticInputs).toHaveBeenCalledWith('business-1', '2026-07-19', '2026-08-01', 100);
  });

  it('starts one server-owned review thread for the tenant creative', async () => {
    mocks.start.mockResolvedValue({ threadId: 12, created: true });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ operation: 'start', businessId: 'other' }) }), context);
    expect(response.status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith('business-1', 44, { title: 'Creative Review: Gift ad', createdBy: 7 });
  });

  it('records exact human context against the supplied thread revision', async () => {
    mocks.recordContext.mockResolvedValue(4);
    const human = { intendedAudience: 'Gift buyers', intendedMessage: 'Choose confidently', offer: 'None', offlineContext: 'Window change' };
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({
      operation: 'context', threadId: 12, expectedRevision: 3, context: human,
    }) }), context);
    expect(response.status).toBe(200);
    expect(mocks.recordContext).toHaveBeenCalledWith('business-1', 44, 12, 3, { actorUserId: 7, context: human });
  });

  it('uses server model and actor identity to generate a non-browser-authorized brief', async () => {
    mocks.generate.mockResolvedValue({ id: 80 });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({
      operation: 'generate', threadId: 12, expectedRevision: 3, diagnosticsThrough: '2026-08-01',
      modelId: 'browser-model', actorUserId: 999,
    }) }), context);
    expect(response.status).toBe(201);
    expect(mocks.gateway).toHaveBeenCalledWith('server-key', expect.objectContaining({
      businessId: 'business-1', area: 'foresight', operation: 'review_creative', actorUserId: 7,
    }));
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', creativeId: 44, threadId: 12, expectedRevision: 3,
      actorUserId: 7, modelId: 'gemini-creative', diagnosticsThrough: '2026-08-01',
    }));
  });

  it('records an allowlisted decision against the exact route-owned creative and server actor', async () => {
    mocks.review.mockResolvedValue(91);
    const documentHash = 'a'.repeat(64);
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({
      operation: 'review', threadId: 12, briefVersionId: 80, documentHash,
      action: 'revision_requested', note: 'Strengthen the proof.', businessId: 'other', actorId: 999,
    }) }), context);
    expect(response.status).toBe(201);
    expect(mocks.review).toHaveBeenCalledWith('business-1', 44, 12, {
      briefVersionId: 80, documentHash, action: 'revision_requested', actorId: 7, note: 'Strengthen the proof.',
    });
  });

  it('rejects review actions outside the exact allowlist', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({
      operation: 'review', threadId: 12, briefVersionId: 80, documentHash: 'a'.repeat(64), action: 'published',
    }) }), context);
    expect(response.status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
