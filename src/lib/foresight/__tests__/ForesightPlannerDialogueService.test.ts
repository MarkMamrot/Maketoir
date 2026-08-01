import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAppendHuman, mockAppendAssistant, mockListMessages, mockLoadPrompt, mockExecuteTool, mockReport } = vi.hoisted(() => ({
  mockAppendHuman: vi.fn(), mockAppendAssistant: vi.fn(), mockListMessages: vi.fn(),
  mockLoadPrompt: vi.fn(), mockExecuteTool: vi.fn(), mockReport: vi.fn(),
}));

vi.mock('../repositories/ForesightPlanningRepository', () => ({
  PlanningThreadConflictError: class PlanningThreadConflictError extends Error {},
  ForesightPlanningRepository: {
    appendHumanMessage: mockAppendHuman,
    appendAssistantMessage: mockAppendAssistant,
    listMessages: mockListMessages,
  },
}));
vi.mock('../prompts/promptManifest', () => ({ loadForesightPrompt: mockLoadPrompt }));
vi.mock('../assistant/ForesightPlannerToolService', () => ({
  ForesightPlannerToolService: { execute: mockExecuteTool },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { ForesightPlannerDialogueService } from '../assistant/ForesightPlannerDialogueService';

describe('ForesightPlannerDialogueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendHuman.mockResolvedValue({ messageId: 30, threadRevision: 3 });
    mockAppendAssistant.mockResolvedValue({ messageId: 31, threadRevision: 4 });
    mockListMessages.mockResolvedValue([{
      id: 30, actor_type: 'human', content: 'Should we promote slow stock?',
    }]);
    mockLoadPrompt.mockResolvedValue({
      version: 'planner-dialogue-v1', content: 'Governed planner prompt', sha256: 'prompt-hash',
    });
    mockReport.mockResolvedValue(91);
  });

  it('executes only allowlisted audited tools and persists a cited assistant turn', async () => {
    const model = { generateJson: vi.fn()
      .mockResolvedValueOnce({ toolCalls: [
        { name: 'get_product_inventory_signals', args: { limit: 10 } },
        { name: 'delete_campaign', args: {} },
      ] })
      .mockResolvedValueOnce({
        message: 'The slow product has excess stock.', citationFactIds: ['fact-stock-1'],
        questions: ['Is clearance consistent with the brand?'],
      }) };
    mockExecuteTool.mockResolvedValue({
      tool: 'get_product_inventory_signals', manifestVersion: 'foresight-planner-tools-v1', truncated: false,
      facts: [{ factId: 'fact-stock-1' }],
    });

    const result = await ForesightPlannerDialogueService.runTurn({
      businessId: 'business-1', threadId: 12, expectedRevision: 2, actorUserId: 7,
      content: 'Should we promote slow stock?', modelId: 'gemini-2.5-flash', model,
    });

    expect(mockAppendHuman).toHaveBeenCalledWith('business-1', 12, 2, {
      actorUserId: 7, content: 'Should we promote slow stock?',
    });
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', threadId: 12, messageId: 30,
      name: 'get_product_inventory_signals', args: { limit: 10 },
    }));
    expect(mockAppendAssistant).toHaveBeenCalledWith('business-1', 12, 3, expect.objectContaining({
      modelId: 'gemini-2.5-flash', promptVersion: 'planner-dialogue-v1',
      message: expect.objectContaining({ citationFactIds: ['fact-stock-1'], toolManifestVersion: 'foresight-planner-tools-v1' }),
    }));
    expect(result).toMatchObject({ assistantMessageId: 31, threadRevision: 4, citationFactIds: ['fact-stock-1'] });
  });

  it('rejects unknown citations and reports the failed operational turn', async () => {
    const model = { generateJson: vi.fn()
      .mockResolvedValueOnce({ toolCalls: [] })
      .mockResolvedValueOnce({ message: 'Invented claim.', citationFactIds: ['invented-fact'], questions: [] }) };

    await expect(ForesightPlannerDialogueService.runTurn({
      businessId: 'business-1', threadId: 12, expectedRevision: 2, actorUserId: 7,
      content: 'What should we do?', modelId: 'gemini-2.5-flash', model,
    })).rejects.toThrow('unknown facts');

    expect(mockAppendAssistant).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'run_dialogue_turn',
      context: { modelId: 'gemini-2.5-flash', humanMessageId: 30 },
    }));
  });

  it('does not report an expected stale assistant response as a runtime issue', async () => {
    const { PlanningThreadConflictError } = await import('../repositories/ForesightPlanningRepository');
    const model = { generateJson: vi.fn()
      .mockResolvedValueOnce({ toolCalls: [] })
      .mockResolvedValueOnce({ message: 'Question?', citationFactIds: [], questions: ['Which goal?'] }) };
    mockAppendAssistant.mockRejectedValue(new PlanningThreadConflictError());

    await expect(ForesightPlannerDialogueService.runTurn({
      businessId: 'business-1', threadId: 12, expectedRevision: 2, actorUserId: 7,
      content: 'What should we do?', modelId: 'gemini-2.5-flash', model,
    })).rejects.toBeInstanceOf(PlanningThreadConflictError);

    expect(mockReport).not.toHaveBeenCalled();
  });
});