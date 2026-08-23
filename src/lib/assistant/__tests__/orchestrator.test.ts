import { describe, expect, it } from 'vitest';

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
});