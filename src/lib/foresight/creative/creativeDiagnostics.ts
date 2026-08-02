export const CREATIVE_DIAGNOSTICS_FORMULA_VERSION = 'foresight-creative-diagnostics-v1';
export const CREATIVE_MINIMUM_TOTAL_IMPRESSIONS = 1_000;
export const CREATIVE_MINIMUM_WINDOW_IMPRESSIONS = 500;
export const CREATIVE_COMPARISON_WINDOW_DAYS = 7;

export interface CreativeDiagnosticMetric {
  metricDate: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  attributedRevenue: number;
  frequency: number | null;
}

export interface CreativeDiagnosticInput {
  creativeId: number;
  source: 'google_ads' | 'meta_ads';
  name: string;
  format: string | null;
  tags: string[];
  brandFitObservations: string[];
  assessmentUncertainties: string[];
  metrics: CreativeDiagnosticMetric[];
  placements?: Array<{ placement: string; impressions: number; clicks: number }>;
}

interface WindowSummary {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  attributedRevenue: number;
  ctr: number | null;
  frequency: number | null;
}

export interface CreativeDiagnosticResult {
  formulaVersion: typeof CREATIVE_DIAGNOSTICS_FORMULA_VERSION;
  throughDate: string;
  comparison: { previousStart: string; previousEnd: string; currentStart: string; currentEnd: string };
  authority: 'platform_diagnostic_non_causal';
  eligibleCreativeCount: number;
  rankingAllowed: boolean;
  qualityIssues: string[];
  creatives: Array<{
    creativeId: number;
    source: CreativeDiagnosticInput['source'];
    name: string;
    eligible: boolean;
    previous: WindowSummary;
    current: WindowSummary;
    ctrChangePercent: number | null;
    signals: Array<'fatigue' | 'saturation' | 'placement_mismatch' | 'brand_review'>;
    explanation: string[];
  }>;
  patterns: Array<{
    tag: string;
    creativeCount: number;
    impressions: number;
    ctr: number;
    portfolioCtr: number;
    direction: 'above_portfolio' | 'below_portfolio' | 'near_portfolio';
    disclaimer: string;
  }>;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function summarize(metrics: CreativeDiagnosticMetric[], start: string, end: string): WindowSummary {
  const rows = metrics.filter((row) => row.metricDate >= start && row.metricDate <= end);
  const impressions = rows.reduce((sum, row) => sum + finiteNonNegative(row.impressions), 0);
  const clicks = rows.reduce((sum, row) => sum + finiteNonNegative(row.clicks), 0);
  const weightedFrequencyRows = rows.filter((row) => row.frequency != null && row.impressions > 0);
  const frequencyImpressions = weightedFrequencyRows.reduce((sum, row) => sum + row.impressions, 0);
  return {
    impressions,
    clicks,
    spend: rows.reduce((sum, row) => sum + finiteNonNegative(row.spend), 0),
    conversions: rows.reduce((sum, row) => sum + finiteNonNegative(row.conversions), 0),
    attributedRevenue: rows.reduce((sum, row) => sum + finiteNonNegative(row.attributedRevenue), 0),
    ctr: impressions > 0 ? clicks / impressions : null,
    frequency: frequencyImpressions > 0
      ? weightedFrequencyRows.reduce((sum, row) => sum + (row.frequency ?? 0) * row.impressions, 0) / frequencyImpressions
      : null,
  };
}

function percentChange(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function diagnoseCreativePerformance(input: {
  throughDate: string;
  creatives: CreativeDiagnosticInput[];
}): CreativeDiagnosticResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.throughDate)) throw new Error('throughDate must be YYYY-MM-DD.');
  const currentEnd = input.throughDate;
  const currentStart = addDays(currentEnd, -(CREATIVE_COMPARISON_WINDOW_DAYS - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(CREATIVE_COMPARISON_WINDOW_DAYS - 1));
  const qualityIssues = new Set<string>();

  const creatives = input.creatives.map((creative) => {
    const previous = summarize(creative.metrics, previousStart, previousEnd);
    const current = summarize(creative.metrics, currentStart, currentEnd);
    const totalImpressions = previous.impressions + current.impressions;
    const eligible = totalImpressions >= CREATIVE_MINIMUM_TOTAL_IMPRESSIONS
      && previous.impressions >= CREATIVE_MINIMUM_WINDOW_IMPRESSIONS
      && current.impressions >= CREATIVE_MINIMUM_WINDOW_IMPRESSIONS;
    const ctrChangePercent = eligible ? percentChange(previous.ctr, current.ctr) : null;
    const signals: Array<'fatigue' | 'saturation' | 'placement_mismatch' | 'brand_review'> = [];
    const explanation: string[] = [];
    if (!eligible) explanation.push('Insufficient exposure for a two-window trend assessment.');
    if (eligible && ctrChangePercent != null && ctrChangePercent <= -25) {
      signals.push('fatigue');
      explanation.push(`Platform CTR declined ${Math.abs(ctrChangePercent).toFixed(1)}% across adjacent seven-day windows.`);
    }
    if (eligible && current.frequency != null && current.frequency >= 3 && ctrChangePercent != null && ctrChangePercent <= -15) {
      signals.push('saturation');
      explanation.push(`Meta frequency reached ${current.frequency.toFixed(2)} while platform CTR declined.`);
    }
    const placements = creative.placements ?? [];
    const eligiblePlacements = placements.filter((item) => item.impressions >= CREATIVE_MINIMUM_WINDOW_IMPRESSIONS);
    if (eligiblePlacements.length >= 2) {
      const placementCtrs = eligiblePlacements.map((item) => ({ ...item, ctr: item.clicks / item.impressions }));
      const best = Math.max(...placementCtrs.map((item) => item.ctr));
      const worst = Math.min(...placementCtrs.map((item) => item.ctr));
      if (best > 0 && worst <= best * 0.5) {
        signals.push('placement_mismatch');
        explanation.push('Platform CTR differs by at least 50% between adequately exposed placements.');
      }
    } else {
      qualityIssues.add('Placement mismatch was not evaluated because at least two placement-grain observations with sufficient exposure were unavailable.');
    }
    if (creative.brandFitObservations.length > 0 || creative.assessmentUncertainties.length > 0) {
      signals.push('brand_review');
      explanation.push('The latest governed assessment contains brand-fit observations or unresolved uncertainty for human review.');
    }
    return { creativeId: creative.creativeId, source: creative.source, name: creative.name, eligible,
      previous, current, ctrChangePercent, signals, explanation };
  });

  const eligibleIds = new Set(creatives.filter((creative) => creative.eligible).map((creative) => creative.creativeId));
  const rankingAllowed = eligibleIds.size >= 2;
  if (!rankingAllowed) qualityIssues.add('At least two creatives with sufficient exposure are required before comparative ranking or pattern analysis.');
  const eligibleInputs = input.creatives.filter((creative) => eligibleIds.has(creative.creativeId));
  const portfolio = creatives.filter((creative) => creative.eligible).reduce((total, creative) => ({
    impressions: total.impressions + creative.current.impressions,
    clicks: total.clicks + creative.current.clicks,
  }), { impressions: 0, clicks: 0 });
  const portfolioCtr = portfolio.impressions > 0 ? portfolio.clicks / portfolio.impressions : 0;
  const tagGroups = new Map<string, Set<number>>();
  for (const creative of eligibleInputs) {
    for (const tag of [...new Set(creative.tags.map((item) => item.trim().toLowerCase()).filter(Boolean))]) {
      const ids = tagGroups.get(tag) ?? new Set<number>();
      ids.add(creative.creativeId);
      tagGroups.set(tag, ids);
    }
  }
  const patterns = rankingAllowed ? [...tagGroups.entries()].flatMap(([tag, ids]) => {
    if (ids.size < 2) return [];
    const summaries = creatives.filter((creative) => ids.has(creative.creativeId));
    const impressions = summaries.reduce((sum, creative) => sum + creative.current.impressions, 0);
    const clicks = summaries.reduce((sum, creative) => sum + creative.current.clicks, 0);
    if (impressions < CREATIVE_MINIMUM_TOTAL_IMPRESSIONS) return [];
    const ctr = clicks / impressions;
    const ratio = portfolioCtr > 0 ? ctr / portfolioCtr : 1;
    return [{ tag, creativeCount: ids.size, impressions, ctr, portfolioCtr,
      direction: ratio >= 1.15 ? 'above_portfolio' as const : ratio <= 0.85 ? 'below_portfolio' as const : 'near_portfolio' as const,
      disclaimer: 'This is a platform-attributed directional association, not evidence that the creative trait caused performance.' }];
  }).sort((left, right) => right.impressions - left.impressions || left.tag.localeCompare(right.tag)) : [];

  return {
    formulaVersion: CREATIVE_DIAGNOSTICS_FORMULA_VERSION,
    throughDate: input.throughDate,
    comparison: { previousStart, previousEnd, currentStart, currentEnd },
    authority: 'platform_diagnostic_non_causal',
    eligibleCreativeCount: eligibleIds.size,
    rankingAllowed,
    qualityIssues: [...qualityIssues],
    creatives,
    patterns,
  };
}
