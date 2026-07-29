import { describe, expect, it } from 'vitest';
import { assertRecommendationTransition, canTransitionRecommendation } from '../recommendationState';

describe('Foresight recommendation state machine', () => {
  it('allows the shadow approval path', () => {
    expect(canTransitionRecommendation('shadow', 'pending_approval')).toBe(true);
    expect(canTransitionRecommendation('pending_approval', 'approved')).toBe(true);
    expect(canTransitionRecommendation('approved', 'executing')).toBe(true);
    expect(canTransitionRecommendation('executing', 'succeeded')).toBe(true);
  });

  it('allows rejecting a shadow recommendation', () => {
    expect(canTransitionRecommendation('shadow', 'rejected')).toBe(true);
  });

  it('prevents execution without approval', () => {
    expect(() => assertRecommendationTransition('shadow', 'executing')).toThrow(
      'Invalid Foresight recommendation transition: shadow -> executing',
    );
  });

  it('keeps terminal states terminal except successful compensation', () => {
    expect(canTransitionRecommendation('rejected', 'shadow')).toBe(false);
    expect(canTransitionRecommendation('failed', 'executing')).toBe(false);
    expect(canTransitionRecommendation('succeeded', 'compensated')).toBe(true);
  });
});
