import { MarketingDataRepository, type MarketingDataRow } from '@/lib/db/MarketingDataRepository';
import { ForesightIngestionRepository, mysqlDateOnly } from './repositories/ForesightIngestionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';
import {
  evaluateGa4ChannelRules,
  GA4_CHANNEL_FORMULA_VERSION,
  GA4_CHANNEL_POLICY_VERSION,
  type Ga4ChannelObservation,
} from './rules/ga4ChannelRules';

const GA4_RULE_IDS = ['ga4_channel_conversion_rate_decline'];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value: unknown): string {
  if (value instanceof Date) return mysqlDateOnly(value);
  const text = String(value ?? '');
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text.slice(0, 10);
}

function normalize(row: MarketingDataRow): Ga4ChannelObservation {
  const metrics = object(row.metrics);
  return {
    metricDate: compactDate(metrics.date ?? row.record_date),
    channel: String(metrics.sessionDefaultChannelGroup ?? row.entity_name ?? '').trim(),
    sessions: number(metrics.sessions),
    conversions: number(metrics.conversions),
    revenue: number(metrics.totalRevenue),
  };
}

export const Ga4RecommendationService = {
  async evaluateChannels(businessId: string, throughDate: string) {
    const previousStart = addDays(throughDate, -13);
    const snapshot = await ForesightIngestionRepository.getLatestSyncTabOutcome(businessId, 'ga4', 'GA4_Channels');
    if (
      !snapshot
      || snapshot.state !== 'succeeded'
      || !snapshot.window_start
      || !snapshot.window_end
      || compactDate(snapshot.window_start) > previousStart
      || compactDate(snapshot.window_end) < throughDate
    ) {
      return {
        evaluatedThrough: throughDate,
        skipped: true,
        skipReason: snapshot ? 'ga4_channel_snapshot_does_not_cover_window' : 'no_successful_ga4_channel_snapshot',
        recommendationCount: 0,
        expiredCount: 0,
        recommendations: [],
      };
    }
    const rows = await MarketingDataRepository.getTab(businessId, 'ga4', 'GA4_Channels');
    const recommendations = evaluateGa4ChannelRules(rows.map(normalize), throughDate);
    const persisted = [];
    for (const recommendation of recommendations) {
      const id = await ForesightRepository.createRecommendation(businessId, {
        ...recommendation,
        policyVersion: GA4_CHANNEL_POLICY_VERSION,
        formulaVersion: GA4_CHANNEL_FORMULA_VERSION,
        expiresAt: `${addDays(throughDate, 7)} 23:59:59`,
      });
      persisted.push({ id, ...recommendation });
    }
    const expiredCount = await ForesightRepository.expireSupersededShadowRecommendations(
      businessId,
      GA4_RULE_IDS,
      recommendations.map((recommendation) => recommendation.fingerprint),
    );
    return { evaluatedThrough: throughDate, skipped: false, recommendationCount: persisted.length, expiredCount, recommendations: persisted };
  },
};