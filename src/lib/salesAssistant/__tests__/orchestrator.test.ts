import { describe, expect, it, vi } from 'vitest';
import { normalizeSalesDecision, runProspectSalesAssistant, SALES_MODEL, SALES_PROMPT_VERSION } from '../orchestrator';

describe('sales response normalization', () => {
  it('defaults to an approved model with complete commercial pricing', () => {
    expect(SALES_MODEL).toBe('gemini-3.5-flash-lite');
    expect(SALES_PROMPT_VERSION).toBe('prospect-sales-v3');
  });

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
    expect(() => normalizeSalesDecision({ answer: 'We can discuss that.', followUpQuestion: 'Can you navigate to the settings screen?' }, new Set())).toThrow('procedural detail');
  });
});

describe('route-like sales orchestration', () => {
  it('grounds Shopify loyalty answers in the confirmed native workflow', async () => {
    const repository = {
      prepareUserPrompt: vi.fn(async () => ({ conversationId: 'conversation-1', userMessageId: 'user-1' })),
      listPublicEnabledIntegrations: vi.fn(async () => []),
      appendAssistantMessage: vi.fn(async () => ({ messageId: 'assistant-1' })),
    };
    const generateJson = vi.fn(async ({ systemInstruction, context }: { systemInstruction: string; context: string }) => {
      const supplied = JSON.parse(context);
      expect(supplied.publicSources[0]).toMatchObject({
        id: 'prospect-shopify-loyalty',
        title: 'Shopify and Loyalty',
        availability: 'confirmed',
      });
      expect(supplied.publicSources[0].summary).toMatch(/one loyalty program.*POS.*Shopify/i);
      expect(systemInstruction).toMatch(/answer clearly/i);
      return JSON.stringify({
        answer: 'Yes. Solvantis can run one loyalty program across its POS and a connected Shopify store.',
        fit: 'needs_discovery', intent: 'evaluating', sourceIds: ['prospect-shopify-loyalty'], offerContact: false,
      });
    });

    const result = await runProspectSalesAssistant({
      sessionId: 'session', message: 'Does your system allow loyalty integrated with Shopify?',
    }, { repository, generateJson, reportFailure: vi.fn(async () => null) });

    expect(result).toMatchObject({ fit: 'strong_fit', sourceIds: ['prospect-shopify-loyalty'] });
  });

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
      retrieveKnowledge: () => [{
        id: 'public-1', title: 'Retail', summary: 'Multi-location retail.', capabilities: ['locations'],
        product: 'prospect', availability: 'qualified', score: 5,
      }],
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
