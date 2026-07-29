import type {
  RecommendationEventRow,
  RecommendationImplementationRow,
  RecommendationOutcomeRow,
  RecommendationRow,
} from './repositories/ForesightRepository';

export type DailyDigestItemKind =
  | 'pending_approval'
  | 'implementation_overdue'
  | 'expiring_soon'
  | 'outcome_available'
  | 'data_quality_blocked';

export interface DailyDigestItem {
  kind: DailyDigestItemKind;
  priority: 'high' | 'medium' | 'info';
  recommendationId: number;
  channel: string;
  title: string;
  detail: string;
}

export interface DailyDigestSnapshot {
  version: 1;
  digestDate: string;
  counts: {
    total: number;
    high: number;
    pendingApproval: number;
    implementationOverdue: number;
    expiringSoon: number;
    outcomeAvailable: number;
    dataQualityBlocked: number;
  };
  items: DailyDigestItem[];
}

const DAY_MS = 86_400_000;

function isoDate(value: string): string {
  return value.slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${isoDate(to)}T00:00:00Z`) - Date.parse(`${isoDate(from)}T00:00:00Z`)) / DAY_MS);
}

function subject(recommendation: RecommendationRow): string {
  return recommendation.channel === 'klaviyo' ? 'Klaviyo lifecycle recommendation' : 'Paid-media recommendation';
}

const PRIORITY_ORDER: Record<DailyDigestItem['priority'], number> = { high: 0, medium: 1, info: 2 };
const KIND_ORDER: Record<DailyDigestItemKind, number> = {
  pending_approval: 0,
  implementation_overdue: 1,
  expiring_soon: 2,
  data_quality_blocked: 3,
  outcome_available: 4,
};

export function buildDailyDigest(input: {
  digestDate: string;
  recommendations: RecommendationRow[];
  events: RecommendationEventRow[];
  implementations: RecommendationImplementationRow[];
  outcomes: RecommendationOutcomeRow[];
  implementationGraceDays?: number;
  expiryWarningDays?: number;
}): DailyDigestSnapshot {
  const implementationGraceDays = Math.max(1, Math.trunc(input.implementationGraceDays ?? 2));
  const expiryWarningDays = Math.max(0, Math.trunc(input.expiryWarningDays ?? 2));
  const items: DailyDigestItem[] = [];
  const implementationIds = new Set(input.implementations.map((item) => item.recommendation_id));
  const approvedOn = new Map<number, string>();
  for (const event of input.events) {
    if (event.to_state === 'approved') approvedOn.set(event.recommendation_id, isoDate(event.created_at));
  }

  for (const recommendation of input.recommendations) {
    if (recommendation.state === 'pending_approval') {
      items.push({
        kind: 'pending_approval', priority: 'high', recommendationId: recommendation.id,
        channel: recommendation.channel, title: `${subject(recommendation)} awaits approval`,
        detail: `Review rule ${recommendation.rule_id} before its evidence becomes stale.`,
      });
    }

    const approvalDate = approvedOn.get(recommendation.id);
    if (recommendation.state === 'approved' && approvalDate && !implementationIds.has(recommendation.id)) {
      const ageDays = daysBetween(approvalDate, input.digestDate);
      if (ageDays >= implementationGraceDays) {
        items.push({
          kind: 'implementation_overdue', priority: 'high', recommendationId: recommendation.id,
          channel: recommendation.channel, title: `${subject(recommendation)} has not been implemented`,
          detail: `Approved ${ageDays} days ago. Implement it, record the external change, or revisit the decision.`,
        });
      }
    }

    if (recommendation.expires_at && ['shadow', 'pending_approval', 'approved'].includes(recommendation.state)) {
      const daysRemaining = daysBetween(input.digestDate, recommendation.expires_at);
      if (daysRemaining >= 0 && daysRemaining <= expiryWarningDays) {
        items.push({
          kind: 'expiring_soon', priority: daysRemaining === 0 ? 'high' : 'medium',
          recommendationId: recommendation.id, channel: recommendation.channel,
          title: `${subject(recommendation)} expires ${daysRemaining === 0 ? 'today' : `in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`}`,
          detail: `Rule ${recommendation.rule_id} needs review before ${isoDate(recommendation.expires_at)}.`,
        });
      }
    }

    const blockingIssues = recommendation.evidence_json.quality?.issues?.filter((issue) => issue.severity === 'blocking') ?? [];
    if (blockingIssues.length > 0 && ['shadow', 'pending_approval', 'approved'].includes(recommendation.state)) {
      items.push({
        kind: 'data_quality_blocked', priority: 'medium', recommendationId: recommendation.id,
        channel: recommendation.channel, title: `${subject(recommendation)} has blocked evidence`,
        detail: blockingIssues.map((issue) => issue.message).join(' '),
      });
    }
  }

  const recommendationById = new Map(input.recommendations.map((item) => [item.id, item]));
  for (const outcome of input.outcomes) {
    if (isoDate(outcome.created_at) !== input.digestDate) continue;
    const recommendation = recommendationById.get(outcome.recommendation_id);
    if (!recommendation) continue;
    items.push({
      kind: 'outcome_available', priority: outcome.direction === 'worsened' ? 'high' : 'info',
      recommendationId: recommendation.id, channel: recommendation.channel,
      title: `${subject(recommendation)} outcome: ${outcome.direction}`,
      detail: `The ${outcome.horizon_days}-day follow-up is ${outcome.condition_state}; review the measured result.`,
    });
  }

  items.sort((left, right) =>
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || left.recommendationId - right.recommendationId,
  );

  const count = (kind: DailyDigestItemKind) => items.filter((item) => item.kind === kind).length;
  return {
    version: 1,
    digestDate: input.digestDate,
    counts: {
      total: items.length,
      high: items.filter((item) => item.priority === 'high').length,
      pendingApproval: count('pending_approval'),
      implementationOverdue: count('implementation_overdue'),
      expiringSoon: count('expiring_soon'),
      outcomeAvailable: count('outcome_available'),
      dataQualityBlocked: count('data_quality_blocked'),
    },
    items,
  };
}