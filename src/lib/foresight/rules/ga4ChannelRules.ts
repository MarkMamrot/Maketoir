import type { RecommendationEvidence } from '../types';

export const GA4_CHANNEL_POLICY_VERSION = 1;
export const GA4_CHANNEL_FORMULA_VERSION = 'foresight-ga4-channel-v1';

export interface Ga4ChannelObservation {
  metricDate: string;
  channel: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

export interface Ga4ChannelRecommendation {
  fingerprint: string;
  channel: 'ga4';
  subjectType: 'channel';
  subjectId: string;
  ruleId: 'ga4_channel_conversion_rate_decline';
  evidence: RecommendationEvidence;
  proposedAction: Record<string, unknown>;
  confidence: number;
  expectedImpactLow: null;
  expectedImpactHigh: null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function totals(rows: Ga4ChannelObservation[]) {
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  const conversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  return { sessions, conversions, revenue, conversionRate: sessions > 0 ? conversions / sessions : null };
}

export function evaluateGa4ChannelRules(
  rows: Ga4ChannelObservation[],
  throughDate: string,
  policy = { windowDays: 7, minimumSessions: 100, minimumPreviousConversions: 5, declinePercent: 30 },
): Ga4ChannelRecommendation[] {
  const currentStart = addDays(throughDate, -(policy.windowDays - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(policy.windowDays - 1));
  const channels = [...new Set(rows.map((row) => row.channel).filter(Boolean))].sort();
  const recommendations: Ga4ChannelRecommendation[] = [];

  for (const channel of channels) {
    const channelRows = rows.filter((row) => row.channel === channel);
    const current = totals(channelRows.filter((row) => row.metricDate >= currentStart && row.metricDate <= throughDate));
    const previous = totals(channelRows.filter((row) => row.metricDate >= previousStart && row.metricDate <= previousEnd));
    if (
      current.sessions < policy.minimumSessions
      || previous.sessions < policy.minimumSessions
      || previous.conversions < policy.minimumPreviousConversions
      || current.conversionRate == null
      || previous.conversionRate == null
      || previous.conversionRate <= 0
    ) continue;
    const declinePercent = ((previous.conversionRate - current.conversionRate) / previous.conversionRate) * 100;
    if (declinePercent < policy.declinePercent) continue;
    const subjectId = channel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    recommendations.push({
      fingerprint: `ga4_channel_conversion_rate_decline:${subjectId}:${currentStart}:${throughDate}:p${GA4_CHANNEL_POLICY_VERSION}`,
      channel: 'ga4',
      subjectType: 'channel',
      subjectId,
      ruleId: 'ga4_channel_conversion_rate_decline',
      evidence: {
        metricKeys: ['ga4_channel_conversion_rate'],
        sourceIds: [`ga4:channels:${channel}:${previousStart}:${throughDate}`],
        windowStart: currentStart,
        windowEnd: throughDate,
        quality: { grade: 'good', issues: [] },
        observedValues: {
          currentSessions: current.sessions,
          previousSessions: previous.sessions,
          currentConversions: current.conversions,
          previousConversions: previous.conversions,
          currentConversionRate: current.conversionRate,
          previousConversionRate: previous.conversionRate,
          conversionRateDeclinePercent: declinePercent,
          declineThresholdPercent: policy.declinePercent,
        },
      },
      proposedAction: {
        type: 'investigate_ga4_channel_funnel',
        channel,
        reason: `${channel} conversion rate declined materially between comparable seven-day windows.`,
      },
      confidence: 0.8,
      expectedImpactLow: null,
      expectedImpactHigh: null,
    });
  }
  return recommendations;
}