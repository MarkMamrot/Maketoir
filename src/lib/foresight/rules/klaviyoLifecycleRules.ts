import type { KlaviyoFlowRecord } from '@/services/KlaviyoService';
import type { KlaviyoFlowCoverageEvidence, RecommendationEvidence } from '../types';

export const KLAVIYO_LIFECYCLE_POLICY_VERSION = 1;
export const KLAVIYO_LIFECYCLE_FORMULA_VERSION = 'foresight-klaviyo-lifecycle-v1';

const FLOW_CATEGORIES: Array<{
  id: KlaviyoFlowCoverageEvidence['category'];
  code: string;
  label: string;
  patterns: RegExp[];
}> = [
  { id: 'welcome', code: 'W', label: 'Welcome series', patterns: [/\bwelcome\b/, /new (subscriber|customer)/] },
  { id: 'abandoned_cart', code: 'AC', label: 'Abandoned cart', patterns: [/abandon(?:ed|ment)? (cart|checkout)/, /cart recovery/] },
  { id: 'browse_abandonment', code: 'BA', label: 'Browse abandonment', patterns: [/browse abandon(?:ed|ment)?/, /abandoned browse/] },
  { id: 'post_purchase', code: 'PP', label: 'Post-purchase', patterns: [/post purchase/, /order follow up/, /thank you/] },
  { id: 'win_back', code: 'WB', label: 'Win-back', patterns: [/win back/, /re engag/, /lapsed/] },
  { id: 'vip_loyalty', code: 'VIP', label: 'VIP or loyalty', patterns: [/\bvip\b/, /loyalty/, /rewards/] },
];

export interface KlaviyoLifecycleRecommendation {
  fingerprint: string;
  channel: 'klaviyo';
  subjectType: 'account';
  subjectId: 'klaviyo';
  ruleId: 'klaviyo_lifecycle_coverage_gap';
  evidence: RecommendationEvidence;
  proposedAction: Record<string, unknown>;
  confidence: number;
  expectedImpactLow: null;
  expectedImpactHigh: null;
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isArchived(flow: KlaviyoFlowRecord): boolean {
  return flow.archived.toLowerCase() === 'true';
}

function isActive(flow: KlaviyoFlowRecord): boolean {
  return !isArchived(flow) && flow.status.toLowerCase() === 'live';
}

function coverage(flows: KlaviyoFlowRecord[]): KlaviyoFlowCoverageEvidence[] {
  return FLOW_CATEGORIES.map((category) => {
    const matches = flows.filter((flow) => {
      const name = normalizedName(flow.name);
      return category.patterns.some((pattern) => pattern.test(name));
    });
    return {
      category: category.id,
      label: category.label,
      state: matches.some(isActive) ? 'active' : matches.length > 0 ? 'inactive' : 'missing',
      matchedFlows: matches.map((flow) => ({
        id: flow.id,
        name: flow.name,
        status: flow.status,
        archived: isArchived(flow),
      })),
    };
  });
}

export function evaluateKlaviyoLifecycleRules(
  flows: KlaviyoFlowRecord[],
  snapshotRunId: number,
  evaluatedThrough: string,
): KlaviyoLifecycleRecommendation[] {
  const flowCoverage = coverage(flows);
  const missing = flowCoverage.filter((item) => item.state === 'missing');
  const inactive = flowCoverage.filter((item) => item.state === 'inactive');
  if (missing.length === 0 && inactive.length === 0) return [];

  const signature = FLOW_CATEGORIES
    .filter((category) => flowCoverage.some((item) => item.category === category.id && item.state !== 'active'))
    .map((category) => {
      const state = flowCoverage.find((item) => item.category === category.id)?.state;
      return `${category.code}${state === 'inactive' ? 'I' : 'M'}`;
    })
    .join('.');
  const activeFlowCount = flows.filter(isActive).length;
  const activeCategoryCount = flowCoverage.filter((item) => item.state === 'active').length;

  return [{
    fingerprint: `klaviyo_lifecycle_coverage:klaviyo:${signature}:run${snapshotRunId}:p${KLAVIYO_LIFECYCLE_POLICY_VERSION}`,
    channel: 'klaviyo',
    subjectType: 'account',
    subjectId: 'klaviyo',
    ruleId: 'klaviyo_lifecycle_coverage_gap',
    evidence: {
      metricKeys: ['klaviyo_critical_flow_coverage'],
      sourceIds: [`klaviyo:flows:run-${snapshotRunId}`],
      windowStart: evaluatedThrough,
      windowEnd: evaluatedThrough,
      quality: { grade: 'good', issues: [] },
      observedValues: {
        flowCount: flows.length,
        activeFlowCount,
        activeCriticalFlowCount: activeCategoryCount,
        missingCriticalFlowCount: missing.length,
        inactiveCriticalFlowCount: inactive.length,
      },
      lifecycleFlowCoverage: flowCoverage,
    },
    proposedAction: {
      type: 'review_klaviyo_lifecycle_flows',
      missingCategories: missing.map((item) => item.label),
      inactiveCategories: inactive.map((item) => item.label),
      reason: 'Critical lifecycle email coverage is incomplete or inactive.',
    },
    confidence: 0.9,
    expectedImpactLow: null,
    expectedImpactHigh: null,
  }];
}