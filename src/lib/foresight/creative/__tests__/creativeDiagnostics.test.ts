import { describe, expect, it } from 'vitest';
import { diagnoseCreativePerformance, type CreativeDiagnosticInput } from '../creativeDiagnostics';

function creative(input: Partial<CreativeDiagnosticInput> & { creativeId: number; previousClicks: number; currentClicks: number }): CreativeDiagnosticInput {
  const source = input.source ?? 'meta_ads';
  const metrics = Array.from({ length: 14 }, (_, index) => ({
    metricDate: `2026-07-${String(19 + index).padStart(2, '0')}`,
    impressions: 100,
    clicks: index < 7 ? input.previousClicks / 7 : input.currentClicks / 7,
    spend: 10,
    conversions: 1,
    attributedRevenue: 20,
    frequency: source === 'meta_ads' ? (index < 7 ? 2 : 3.2) : null,
  }));
  return { creativeId: input.creativeId, source, name: input.name ?? `Creative ${input.creativeId}`,
    format: 'image', tags: input.tags ?? ['product-led'], brandFitObservations: input.brandFitObservations ?? [],
    assessmentUncertainties: input.assessmentUncertainties ?? [], metrics, placements: input.placements };
}

describe('diagnoseCreativePerformance', () => {
  it('refuses ranking when fewer than two creatives have sufficient exposure', () => {
    const result = diagnoseCreativePerformance({ throughDate: '2026-08-01', creatives: [
      creative({ creativeId: 1, previousClicks: 40, currentClicks: 20 }),
      { ...creative({ creativeId: 2, previousClicks: 40, currentClicks: 40 }), metrics: [] },
    ] });

    expect(result.rankingAllowed).toBe(false);
    expect(result.patterns).toEqual([]);
    expect(result.qualityIssues).toContain('At least two creatives with sufficient exposure are required before comparative ranking or pattern analysis.');
  });

  it('flags directional fatigue and saturation without making a causal claim', () => {
    const result = diagnoseCreativePerformance({ throughDate: '2026-08-01', creatives: [
      creative({ creativeId: 1, previousClicks: 56, currentClicks: 28, tags: ['product-led', 'offer'] }),
      creative({ creativeId: 2, previousClicks: 42, currentClicks: 42, tags: ['product-led'] }),
    ] });

    expect(result.rankingAllowed).toBe(true);
    expect(result.authority).toBe('platform_diagnostic_non_causal');
    expect(result.creatives[0]).toMatchObject({ eligible: true, signals: expect.arrayContaining(['fatigue', 'saturation']) });
    expect(result.patterns[0]).toMatchObject({ tag: 'product-led', creativeCount: 2 });
    expect(result.patterns[0].disclaimer).toContain('not evidence');
  });

  it('requires two adequately exposed placements before reporting mismatch', () => {
    const result = diagnoseCreativePerformance({ throughDate: '2026-08-01', creatives: [
      creative({ creativeId: 1, previousClicks: 40, currentClicks: 40, placements: [
        { placement: 'feed', impressions: 1_000, clicks: 40 }, { placement: 'stories', impressions: 1_000, clicks: 10 },
      ] }),
      creative({ creativeId: 2, previousClicks: 40, currentClicks: 40 }),
    ] });

    expect(result.creatives[0].signals).toContain('placement_mismatch');
    expect(result.qualityIssues).toContain('Placement mismatch was not evaluated because at least two placement-grain observations with sufficient exposure were unavailable.');
  });
});
