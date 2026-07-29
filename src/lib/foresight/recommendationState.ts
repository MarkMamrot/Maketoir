import type { RecommendationState } from './types';

const ALLOWED_TRANSITIONS: Record<RecommendationState, readonly RecommendationState[]> = {
  draft: ['shadow'],
  shadow: ['pending_approval', 'rejected', 'expired'],
  pending_approval: ['approved', 'rejected', 'expired'],
  approved: ['executing', 'expired'],
  rejected: [],
  expired: [],
  executing: ['succeeded', 'failed'],
  succeeded: ['compensated'],
  failed: [],
  compensated: [],
};

export function canTransitionRecommendation(
  from: RecommendationState,
  to: RecommendationState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertRecommendationTransition(
  from: RecommendationState,
  to: RecommendationState,
): void {
  if (!canTransitionRecommendation(from, to)) {
    throw new Error(`Invalid Foresight recommendation transition: ${from} -> ${to}`);
  }
}
