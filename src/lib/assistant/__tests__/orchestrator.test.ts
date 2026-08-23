import { describe, expect, it, vi } from 'vitest';

import { assistantOrchestratorInternals } from '../orchestrator';

describe('assistant response normalization', () => {
  it('rejects non-JSON model output', () => {
    expect(() => assistantOrchestratorInternals.parseDecision('not json')).toThrow();
  });

  it('normalizes a bounded workflow candidate', () => {
    expect(assistantOrchestratorInternals.normalizeCandidate({
      category: 'workflow_gap',
      capability: 'orders',
      goal: 'Preserve the required stock history',
      essentialConstraints: ['No duplicate movement'],
      alternativesChecked: [{ path: 'Documented path', limitation: 'Does not preserve the reference' }],
    })).toEqual(expect.objectContaining({
      category: 'workflow_gap',
      capability: 'orders',
      attemptedPath: null,
    }));
  });

  it('does not accept an unknown model-supplied finding category', () => {
    expect(assistantOrchestratorInternals.normalizeCandidate({
      category: 'confirmed_bug', capability: 'orders', goal: 'Do something',
    })).toBeNull();
  });

  it('runs multiple bounded read steps and requires a final synthesis pass', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ mode: 'tool', tool: 'ims_order_summary', arguments: { orderType: 'sales', reference: 'SO-1' } })
      .mockResolvedValueOnce({ mode: 'tool', tool: 'ims_product_lookup', arguments: { search: 'SKU-1' } })
      .mockResolvedValueOnce({ mode: 'answer', answer: 'Synthesized answer', sourceIds: [] });
    const execute = vi.fn(async (name: string) => ({ source: name }));

    const result = await assistantOrchestratorInternals.runResearchLoop({
      tools: [
        { name: 'ims_order_summary', description: 'Order', audiences: ['ims'], arguments: {} },
        { name: 'ims_product_lookup', description: 'Product', audiences: ['ims'], arguments: {} },
      ],
      request,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.toolResults.map(step => step.name)).toEqual(['ims_order_summary', 'ims_product_lookup']);
    expect(request.mock.calls[2][1]).toBe(false);
    expect(result.decision).toMatchObject({ mode: 'answer', answer: 'Synthesized answer' });
  });

  it('stops repeated tool calls and forces synthesis', async () => {
    const duplicate = { mode: 'tool', tool: 'ims_product_lookup', arguments: { search: 'SKU-1' } };
    const request = vi.fn()
      .mockResolvedValueOnce(duplicate)
      .mockResolvedValueOnce(duplicate)
      .mockResolvedValueOnce({ mode: 'answer', answer: 'Final', sourceIds: [] });
    const execute = vi.fn(async () => []);

    const result = await assistantOrchestratorInternals.runResearchLoop({
      tools: [{ name: 'ims_product_lookup', description: 'Product', audiences: ['ims'], arguments: {} }],
      request,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[2][1]).toBe(true);
    expect(result.decision.mode).toBe('answer');
  });

  it('never executes more than four research tools', async () => {
    let call = 0;
    const request = vi.fn(async (_results: unknown[], mustAnswer: boolean) => {
      if (mustAnswer) return { mode: 'answer', answer: 'Final', sourceIds: [] };
      call += 1;
      return { mode: 'tool', tool: 'ims_product_lookup', arguments: { search: `SKU-${call}` } };
    });
    const execute = vi.fn(async () => []);

    const result = await assistantOrchestratorInternals.runResearchLoop({
      tools: [{ name: 'ims_product_lookup', description: 'Product', audiences: ['ims'], arguments: {} }],
      request,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(4);
    expect(result.toolResults).toHaveLength(4);
    expect(result.decision.mode).toBe('answer');
  });
});