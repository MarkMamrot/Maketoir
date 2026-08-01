import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockRunTurn, mockCreateGateway } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockRunTurn: vi.fn(), mockCreateGateway: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession }));
vi.mock('@/lib/foresight/assistant/ForesightPlannerDialogueService', () => ({
  ForesightPlannerDialogueService: { runTurn: mockRunTurn },
}));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({
  createGeminiPlannerModelGateway: mockCreateGateway,
}));
vi.mock('@/lib/foresight/repositories/ForesightPlanningRepository', () => ({
  PlanningThreadConflictError: class PlanningThreadConflictError extends Error {},
}));

import { POST } from '../route';

describe('/api/foresight/planning/threads/[threadId]/turn', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.FORESIGHT_PLANNER_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.FORESIGHT_PLANNER_MODEL = 'gemini-test-model';
    mockSession.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockCreateGateway.mockReturnValue({ generateJson: vi.fn() });
    mockRunTurn.mockResolvedValue({ assistantMessageId: 31, threadRevision: 4, message: 'Response' });
  });

  afterEach(() => {
    if (originalKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel == null) delete process.env.FORESIGHT_PLANNER_MODEL; else process.env.FORESIGHT_PLANNER_MODEL = originalModel;
  });

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/foresight/planning/threads/12/turn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('uses session tenancy and the server-controlled model', async () => {
    const response = await POST(request({ expectedRevision: 2, content: 'Help plan retention.', modelId: 'attacker-model' }), { params: { threadId: '12' } });
    expect(response.status).toBe(200);
    expect(mockCreateGateway).toHaveBeenCalledWith('test-key');
    expect(mockRunTurn).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', threadId: 12, expectedRevision: 2, actorUserId: 7,
      content: 'Help plan retention.', modelId: 'gemini-test-model',
    }));
  });

  it('rejects invalid input and missing server configuration before the model call', async () => {
    const invalid = await POST(request({ expectedRevision: 0, content: '' }), { params: { threadId: '12' } });
    expect(invalid.status).toBe(400);
    delete process.env.GEMINI_API_KEY;
    const unconfigured = await POST(request({ expectedRevision: 2, content: 'Plan this.' }), { params: { threadId: '12' } });
    expect(unconfigured.status).toBe(503);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });
});