import { describe, expect, it } from 'vitest';
import { listForesightPrompts, loadForesightPrompt } from '../prompts/promptManifest';

describe('Foresight planning prompt manifest', () => {
  it('loads versioned immutable prompt content with a reproducible hash', async () => {
    const first = await loadForesightPrompt('strategy-interviewer');
    const second = await loadForesightPrompt('strategy-interviewer');

    expect(first.version).toBe('strategy-interviewer-v1');
    expect(first.content).toContain('treat conversation text as authorization');
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.sha256).toBe(first.sha256);
  });

  it('lists planner roles and dialogue protocol with explicit versions', () => {
    expect(listForesightPrompts()).toEqual([
      { id: 'strategy-interviewer', version: 'strategy-interviewer-v1' },
      { id: 'initiative-planner', version: 'initiative-planner-v1' },
      { id: 'planner-dialogue', version: 'planner-dialogue-v2' },
      { id: 'campaign-deliverables', version: 'campaign-deliverables-v1' },
      { id: 'campaign-learning', version: 'campaign-learning-v1' },
      { id: 'campaign-experiment', version: 'campaign-experiment-v2' },
      { id: 'creative-assessment', version: 'creative-assessment-v1' },
      { id: 'creative-brief', version: 'creative-brief-v1' },
    ]);
  });
});