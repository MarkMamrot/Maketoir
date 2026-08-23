import { afterEach, describe, expect, it, vi } from 'vitest';

import { candidateMatchesIdentity, signAssistantCandidate, verifyAssistantCandidate } from '../candidateToken';

describe('assistant candidate tokens', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('signs evidence and binds it to the verified actor', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'assistant-test-secret-that-is-at-least-32-bytes-long');
    const data = {
      businessId: 'biz-1', audience: 'ims' as const, actorType: 'ims_user' as const, actorId: '7',
      currentView: 'orders', promptVersion: 'assistant-v1', indexVersion: '1',
      candidate: {
        category: 'workflow_gap' as const, capability: 'orders', goal: 'Required outcome',
        essentialConstraints: ['Keep stock history'], attemptedPath: null, alternativesChecked: [],
      },
    };
    const verified = verifyAssistantCandidate(signAssistantCandidate(data));
    expect(verified).toEqual(data);
    expect(candidateMatchesIdentity(verified!, data)).toBe(true);
    expect(candidateMatchesIdentity(verified!, { ...data, actorId: '8' })).toBe(false);
  });

  it('rejects a modified token', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'assistant-test-secret-that-is-at-least-32-bytes-long');
    const token = signAssistantCandidate({
      businessId: 'biz-1', audience: 'pos', actorType: 'pos_user', actorId: '4', currentView: null,
      promptVersion: 'assistant-v1', indexVersion: '1',
      candidate: { category: 'edge_case', capability: 'pos', goal: 'Required outcome', essentialConstraints: [], attemptedPath: null, alternativesChecked: [] },
    });
    expect(verifyAssistantCandidate(token.replace('biz-1', 'biz-2'))).toBeNull();
  });
});