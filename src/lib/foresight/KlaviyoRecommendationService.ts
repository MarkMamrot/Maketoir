import type { KlaviyoFlowRecord } from '@/services/KlaviyoService';
import { MarketingDataRepository, type MarketingDataRow } from '@/lib/db/MarketingDataRepository';
import { ForesightIngestionRepository } from './repositories/ForesightIngestionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';
import {
  evaluateKlaviyoLifecycleRules,
  KLAVIYO_LIFECYCLE_FORMULA_VERSION,
  KLAVIYO_LIFECYCLE_POLICY_VERSION,
} from './rules/klaviyoLifecycleRules';

const KLAVIYO_RULE_IDS = ['klaviyo_lifecycle_coverage_gap'];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function metrics(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function normalizeFlow(row: MarketingDataRow): KlaviyoFlowRecord {
  const value = metrics(row.metrics);
  return {
    id: text(value.id || row.entity_id),
    name: text(value.name || row.entity_name),
    status: text(value.status),
    archived: text(value.archived || false),
    trigger_type: text(value.trigger_type),
    created: text(value.created),
    updated: text(value.updated),
  };
}

export const KlaviyoRecommendationService = {
  async evaluateLifecycle(businessId: string, throughDate: string) {
    const snapshot = await ForesightIngestionRepository.getLatestSyncTabOutcome(
      businessId,
      'klaviyo',
      'Klaviyo_Flows',
    );
    if (!snapshot || snapshot.state !== 'succeeded') {
      return {
        evaluatedThrough: throughDate,
        skipped: true,
        skipReason: snapshot ? 'latest_flow_sync_failed' : 'no_successful_flow_snapshot',
        recommendationCount: 0,
        expiredCount: 0,
        recommendations: [],
      };
    }

    const rows = await MarketingDataRepository.getTab(businessId, 'klaviyo', 'Klaviyo_Flows');
    const recommendations = evaluateKlaviyoLifecycleRules(
      rows.map(normalizeFlow),
      snapshot.run_id,
      throughDate,
    );
    const expiresAt = `${addDays(throughDate, 14)} 23:59:59`;
    const persisted = [];

    for (const recommendation of recommendations) {
      const id = await ForesightRepository.createRecommendation(businessId, {
        fingerprint: recommendation.fingerprint,
        channel: recommendation.channel,
        subjectType: recommendation.subjectType,
        subjectId: recommendation.subjectId,
        ruleId: recommendation.ruleId,
        policyVersion: KLAVIYO_LIFECYCLE_POLICY_VERSION,
        formulaVersion: KLAVIYO_LIFECYCLE_FORMULA_VERSION,
        evidence: recommendation.evidence,
        proposedAction: recommendation.proposedAction,
        confidence: recommendation.confidence,
        expectedImpactLow: recommendation.expectedImpactLow,
        expectedImpactHigh: recommendation.expectedImpactHigh,
        expiresAt,
      });
      persisted.push({ id, ...recommendation });
    }

    const expiredCount = await ForesightRepository.expireSupersededShadowRecommendations(
      businessId,
      KLAVIYO_RULE_IDS,
      recommendations.map((recommendation) => recommendation.fingerprint),
    );
    return {
      evaluatedThrough: throughDate,
      snapshotRunId: snapshot.run_id,
      skipped: false,
      recommendationCount: persisted.length,
      expiredCount,
      recommendations: persisted,
    };
  },
};