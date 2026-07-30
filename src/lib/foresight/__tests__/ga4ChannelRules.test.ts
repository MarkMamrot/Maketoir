import { describe, expect, it } from 'vitest';
import { evaluateGa4ChannelRules, type Ga4ChannelObservation } from '../rules/ga4ChannelRules';

function rows(previousConversions: number, currentConversions: number, sessions = 140): Ga4ChannelObservation[] {
  return Array.from({ length: 14 }, (_, index) => ({
    metricDate: `2026-07-${String(index + 16).padStart(2, '0')}`,
    channel: 'Organic Search',
    sessions: sessions / 7,
    conversions: (index < 7 ? previousConversions : currentConversions) / 7,
    revenue: 100,
  }));
}

describe('GA4 channel rules', () => {
  it('flags a material conversion-rate decline with comparable traffic', () => {
    const result = evaluateGa4ChannelRules(rows(14, 7), '2026-07-29');
    expect(result[0]).toMatchObject({
      channel: 'ga4',
      ruleId: 'ga4_channel_conversion_rate_decline',
      subjectId: 'organic-search',
      proposedAction: { type: 'investigate_ga4_channel_funnel', channel: 'Organic Search' },
    });
    expect(result[0].evidence.observedValues?.conversionRateDeclinePercent).toBeCloseTo(50);
  });

  it('does not flag low-volume or immaterial movement', () => {
    expect(evaluateGa4ChannelRules(rows(4, 1), '2026-07-29')).toEqual([]);
    expect(evaluateGa4ChannelRules(rows(14, 12), '2026-07-29')).toEqual([]);
  });
});