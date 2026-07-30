import { diagnosePaidMediaContributors } from './metrics/campaignDiagnosis';
import type { DailyCommerceReconciliation } from './metrics/commerceReconciliation';
import type { DailyPaidMediaEntityObservation, DailyPaidMediaObservation } from './metrics/marketingObservations';
import type {
  RecommendationEventRow,
  RecommendationImplementationRow,
  RecommendationOutcomeRow,
  RecommendationRow,
} from './repositories/ForesightRepository';
import type { DataQualityIssue, KlaviyoFlowCoverageEvidence, PaidMediaContributorEvidence } from './types';

export interface WeeklyDigestFinancialWindow {
  windowStart: string;
  windowEnd: string;
  expectedDays: number;
  observedDays: number;
  complete: boolean;
  googleAdsSpend: number;
  metaAdsSpend: number;
  paidMediaSpend: number;
  onlineRevenueExTax: number;
  posRevenueExTax: number;
  contributionBeforeAds: number | null;
  mer: number | null;
  contributionPoas: number | null;
  platformAttributedRevenue: {
    googleAds: number;
    metaAds: number;
  };
  currencyCodes: string[];
  qualityIssues: DataQualityIssue[];
}

export interface WeeklyDigestOperations {
  recommendationsCreated: number;
  approvals: number;
  rejections: number;
  implementations: number;
  outcomes: {
    total: number;
    improved: number;
    unchanged: number;
    worsened: number;
    unavailable: number;
  };
}

export interface WeeklyKlaviyoCoverage {
  observedAt: string | null;
  activeCriticalFlows: number | null;
  missingCriticalFlows: number | null;
  inactiveCriticalFlows: number | null;
  categories: KlaviyoFlowCoverageEvidence[];
}

export interface WeeklyDigestSnapshot {
  version: 1;
  digestType: 'weekly_summary';
  digestDate: string;
  current: WeeklyDigestFinancialWindow;
  previous: WeeklyDigestFinancialWindow;
  changes: {
    spendPercent: number | null;
    onlineRevenuePercent: number | null;
    merPercent: number | null;
    contributionPoasPercent: number | null;
  };
  operations: WeeklyDigestOperations;
  klaviyo: {
    current: WeeklyKlaviyoCoverage;
    previous: WeeklyKlaviyoCoverage;
  };
  contributors: PaidMediaContributorEvidence[];
  notices: Array<{
    code: string;
    priority: 'high' | 'medium' | 'info';
    message: string;
  }>;
}

const WINDOW_DAYS = 7;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inWindow(value: unknown, start: string, end: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  const date = value.slice(0, 10);
  return date >= start && date <= end;
}

function uniqueIssues(rows: DailyCommerceReconciliation[]): DataQualityIssue[] {
  return [...new Map(rows.flatMap((row) => row.qualityIssues)
    .map((issue) => [`${issue.code}:${issue.severity}`, issue])).values()];
}

function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function aggregateWindow(input: {
  start: string;
  end: string;
  reconciliation: DailyCommerceReconciliation[];
  paidMedia: DailyPaidMediaObservation[];
}): WeeklyDigestFinancialWindow {
  const rows = input.reconciliation
    .filter((row) => inWindow(row.metricDate, input.start, input.end))
    .sort((left, right) => left.metricDate.localeCompare(right.metricDate));
  const observations = input.paidMedia.filter((row) => inWindow(row.metricDate, input.start, input.end));
  const googleAdsSpend = rows.reduce((sum, row) => sum + row.googleAdsSpend, 0);
  const metaAdsSpend = rows.reduce((sum, row) => sum + row.metaAdsSpend, 0);
  const paidMediaSpend = googleAdsSpend + metaAdsSpend;
  const onlineRevenueExTax = rows.reduce((sum, row) => sum + row.onlineNetRevenueExTax, 0);
  const posRevenueExTax = rows.reduce((sum, row) => sum + row.posNetRevenueExTax, 0);
  const contributions = rows.map((row) => row.onlineContribution.contributionProfitBeforeAds.value);
  const contributionBeforeAds = contributions.length === WINDOW_DAYS && contributions.every((value) => value != null)
    ? contributions.reduce((sum, value) => sum + Number(value), 0)
    : null;
  const qualityIssues = uniqueIssues(rows);
  const observedDays = new Set(rows.map((row) => row.metricDate)).size;
  const missingAuthoritative = qualityIssues.some((issue) =>
    issue.severity === 'blocking' || issue.code === 'missing_online_sales_observation');

  return {
    windowStart: input.start,
    windowEnd: input.end,
    expectedDays: WINDOW_DAYS,
    observedDays,
    complete: observedDays === WINDOW_DAYS && !missingAuthoritative,
    googleAdsSpend,
    metaAdsSpend,
    paidMediaSpend,
    onlineRevenueExTax,
    posRevenueExTax,
    contributionBeforeAds,
    mer: paidMediaSpend > 0 ? onlineRevenueExTax / paidMediaSpend : null,
    contributionPoas: paidMediaSpend > 0 && contributionBeforeAds != null
      ? contributionBeforeAds / paidMediaSpend
      : null,
    platformAttributedRevenue: {
      googleAds: observations.filter((row) => row.source === 'google_ads').reduce((sum, row) => sum + row.attributedRevenue, 0),
      metaAds: observations.filter((row) => row.source === 'meta_ads').reduce((sum, row) => sum + row.attributedRevenue, 0),
    },
    currencyCodes: [...new Set(observations.map((row) => row.currencyCode).filter((value): value is string => Boolean(value)))].sort(),
    qualityIssues,
  };
}

function lifecycleSnapshot(recommendations: RecommendationRow[], through: string): WeeklyKlaviyoCoverage {
  const recommendation = recommendations
    .filter((item) => item.channel === 'klaviyo'
      && item.evidence_json.lifecycleFlowCoverage
      && item.evidence_json.windowEnd <= through)
    .sort((left, right) => right.evidence_json.windowEnd.localeCompare(left.evidence_json.windowEnd)
      || right.id - left.id)[0];
  const observed = recommendation?.evidence_json.observedValues ?? {};
  return {
    observedAt: recommendation?.evidence_json.windowEnd ?? null,
    activeCriticalFlows: numberOrNull(observed.activeCriticalFlowCount),
    missingCriticalFlows: numberOrNull(observed.missingCriticalFlowCount),
    inactiveCriticalFlows: numberOrNull(observed.inactiveCriticalFlowCount),
    categories: recommendation?.evidence_json.lifecycleFlowCoverage ?? [],
  };
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return value != null && Number.isFinite(parsed) ? parsed : null;
}

export function buildWeeklyDigest(input: {
  digestDate: string;
  reconciliation: DailyCommerceReconciliation[];
  paidMedia: DailyPaidMediaObservation[];
  paidMediaEntities: DailyPaidMediaEntityObservation[];
  recommendations: RecommendationRow[];
  events: RecommendationEventRow[];
  implementations: RecommendationImplementationRow[];
  outcomes: RecommendationOutcomeRow[];
}): WeeklyDigestSnapshot {
  const currentEnd = input.digestDate;
  const currentStart = addDays(currentEnd, -(WINDOW_DAYS - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(WINDOW_DAYS - 1));
  const current = aggregateWindow({
    start: currentStart, end: currentEnd, reconciliation: input.reconciliation, paidMedia: input.paidMedia,
  });
  const previous = aggregateWindow({
    start: previousStart, end: previousEnd, reconciliation: input.reconciliation, paidMedia: input.paidMedia,
  });
  const outcomes = input.outcomes.filter((item) => inWindow(item.created_at, currentStart, currentEnd));
  const notices: WeeklyDigestSnapshot['notices'] = [];
  if (!current.complete) {
    notices.push({ code: 'current_window_incomplete', priority: 'high', message: `Current financial window has ${current.observedDays} of ${WINDOW_DAYS} observed days${current.qualityIssues.length > 0 ? `; ${current.qualityIssues.map((issue) => issue.message).join(' ')}` : '.'}` });
  }
  if (!previous.complete) {
    notices.push({ code: 'previous_window_incomplete', priority: 'medium', message: `Previous comparison window has ${previous.observedDays} of ${WINDOW_DAYS} observed days${previous.qualityIssues.length > 0 ? `; ${previous.qualityIssues.map((issue) => issue.message).join(' ')}` : '.'}` });
  }
  const merChange = percentChange(current.mer, previous.mer);
  const poasChange = percentChange(current.contributionPoas, previous.contributionPoas);
  if (current.complete && previous.complete && merChange != null && merChange <= -20) {
    notices.push({ code: 'mer_declined', priority: 'high', message: `Authoritative online MER declined ${Math.abs(merChange).toFixed(1)}% week over week.` });
  }
  if (current.complete && previous.complete && poasChange != null && poasChange <= -20) {
    notices.push({ code: 'contribution_poas_declined', priority: 'high', message: `Contribution POAS declined ${Math.abs(poasChange).toFixed(1)}% week over week.` });
  }
  const worsenedOutcomes = outcomes.filter((item) => item.direction === 'worsened').length;
  if (worsenedOutcomes > 0) {
    notices.push({ code: 'worsened_outcomes', priority: 'high', message: `${worsenedOutcomes} measured recommendation outcome${worsenedOutcomes === 1 ? '' : 's'} worsened this week.` });
  }

  return {
    version: 1,
    digestType: 'weekly_summary',
    digestDate: input.digestDate,
    current,
    previous,
    changes: {
      spendPercent: percentChange(current.paidMediaSpend, previous.paidMediaSpend),
      onlineRevenuePercent: percentChange(current.onlineRevenueExTax, previous.onlineRevenueExTax),
      merPercent: merChange,
      contributionPoasPercent: poasChange,
    },
    operations: {
      recommendationsCreated: input.recommendations.filter((item) => inWindow(item.created_at, currentStart, currentEnd)).length,
      approvals: input.events.filter((item) => item.to_state === 'approved' && inWindow(item.created_at, currentStart, currentEnd)).length,
      rejections: input.events.filter((item) => item.to_state === 'rejected' && inWindow(item.created_at, currentStart, currentEnd)).length,
      implementations: input.implementations.filter((item) => inWindow(item.implemented_on, currentStart, currentEnd)).length,
      outcomes: {
        total: outcomes.length,
        improved: outcomes.filter((item) => item.direction === 'improved').length,
        unchanged: outcomes.filter((item) => item.direction === 'unchanged').length,
        worsened: worsenedOutcomes,
        unavailable: outcomes.filter((item) => item.direction === 'unavailable').length,
      },
    },
    klaviyo: {
      current: lifecycleSnapshot(input.recommendations, currentEnd),
      previous: lifecycleSnapshot(input.recommendations, previousEnd),
    },
    contributors: diagnosePaidMediaContributors(input.paidMediaEntities, currentStart, currentEnd),
    notices,
  };
}