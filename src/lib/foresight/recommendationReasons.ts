export const RECOMMENDATION_REASON_OPTIONS = {
  request_approval: [
    { value: 'ready_for_review', label: 'Ready for review' },
    { value: 'needs_specialist_review', label: 'Needs specialist review' },
    { value: 'budget_risk', label: 'Budget risk' },
    { value: 'measurement_risk', label: 'Measurement risk' },
  ],
  approve: [
    { value: 'evidence_supports_action', label: 'Evidence supports action' },
    { value: 'within_guardrails', label: 'Within agreed guardrails' },
    { value: 'approved_with_monitoring', label: 'Approve with monitoring' },
  ],
  reject: [
    { value: 'insufficient_evidence', label: 'Insufficient evidence' },
    { value: 'data_quality_concern', label: 'Data quality concern' },
    { value: 'strategy_mismatch', label: 'Strategy mismatch' },
    { value: 'action_too_aggressive', label: 'Action too aggressive' },
    { value: 'duplicate_or_stale', label: 'Duplicate or stale' },
    { value: 'other', label: 'Other' },
  ],
} as const;

export type RecommendationTransitionAction = keyof typeof RECOMMENDATION_REASON_OPTIONS;

export function isRecommendationReason(
  action: RecommendationTransitionAction,
  reason: unknown,
): reason is string {
  return typeof reason === 'string'
    && RECOMMENDATION_REASON_OPTIONS[action].some((option) => option.value === reason);
}

export function recommendationReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  for (const options of Object.values(RECOMMENDATION_REASON_OPTIONS)) {
    const option = options.find((candidate) => candidate.value === reason);
    if (option) return option.label;
  }
  return reason.replaceAll('_', ' ');
}