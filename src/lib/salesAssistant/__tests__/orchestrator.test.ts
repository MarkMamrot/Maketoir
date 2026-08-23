import { describe, expect, it, vi } from 'vitest';
import { normalizeSalesDecision, runProspectSalesAssistant } from '../orchestrator';

describe('sales response normalization', () => {
  it('normalizes enums and nullable fields and keeps only retrieved source IDs', () => {
    expect(normalizeSalesDecision({ answer: ' Solvantis supports multi-location retail. ', fit: 'invalid', intent: 'high_intent', sourceIds: ['allowed', 'private'], offerContact: true }, new Set(['allowed']))).toEqual({
      answer: 'Solvantis supports multi-location retail.', sourceIds: ['allowed'], followUpQuestion: null,
      fit: 'needs_discovery', intent: 'high_intent', requestedIntegration: null, requestedProvider: null,
      unmetNeed: null, offerContact: true,
    });
  });

  it('rejects procedural and internal detail leakage', () => {
    expect(() => normalizeSalesDecision({ answer: 'First, click the settings button and paste your API key.' }, new Set())).toThrow('procedural detail');
    expect(() => normalizeSalesDecision({ answer: 'Call /api/ims/products to inspect the tenant database.' }, new Set())).toThrow('procedural detail');
  });
});

describe('route-like sales orchestration', () => {
  it('commits the transcript before invoking the model and appends the normalized answer', async () => {
    const order: string[] = [];
    const repository = {
      prepareUserPrompt: vi.fn(async () => { order.push('prepared'); return { conversationId: 'conversation-1', userMessageId: 'user-1' }; }),
      listPublicEnabledIntegrations: vi.fn(async () => []),
      appendAssistantMessage: vi.fn(async () => { order.push('appended'); return { messageId: 'assistant-1' }; }),
    };
    const generateJson = vi.fn(async () => {
      order.push('model');
      expect(order).toEqual(['prepared', 'model']);
      return JSON.stringify({ answer: 'Yes, at a high level.', fit: 'possible_fit', intent: 'evaluating', sourceIds: ['public-1'], offerContact: false });
    });
    const result = await runProspectSalesAssistant({ sessionId: 'session', message: 'Can it work for two stores?' }, {
      repository,
      retrieveKnowledge: () => [{ id: 'public-1', title: 'Retail', summary: 'Multi-location retail.', capabilities: ['locations'], product: 'prospect', score: 5 }],
      generateJson,
      reportFailure: vi.fn(async () => null),
    });
    expect(order).toEqual(['prepared', 'model', 'appended']);
    expect(result).toMatchObject({ conversationId: 'conversation-1', answer: 'Yes, at a high level.', sourceIds: ['public-1'] });
  });

  it('persists a useful fallback and reports only safe identifiers when the model fails', async () => {
    const repository = {
      prepareUserPrompt: vi.fn(async () => ({ conversationId: 'conversation-1', userMessageId: 'user-1' })),
      listPublicEnabledIntegrations: vi.fn(async () => []),
      appendAssistantMessage: vi.fn(async () => ({ messageId: 'assistant-1' })),
    };
    const reportFailure = vi.fn(async () => null);
    const result = await runProspectSalesAssistant({ sessionId: 'session', message: 'secret visitor transcript' }, {
      repository,
      retrieveKnowledge: () => [],
      generateJson: vi.fn(async () => { throw new Error('provider failed'); }),
      reportFailure,
    });
    expect(result.offerContact).toBe(true);
    expect(repository.appendAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('try again') }));
    expect(JSON.stringify(reportFailure.mock.calls[0][0].context)).not.toContain('secret visitor transcript');
  });
});
