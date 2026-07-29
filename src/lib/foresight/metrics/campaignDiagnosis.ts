import type { DailyPaidMediaEntityObservation, PaidMediaEntityType } from './marketingObservations';
import type { PaidMediaContributorEvidence } from '../types';

interface EntityTotals {
  identity: DailyPaidMediaEntityObservation;
  currentSpend: number;
  previousSpend: number;
  currentAttributedRevenue: number;
  previousAttributedRevenue: number;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function platformRoas(revenue: number, spend: number): number | null {
  return spend > 0 ? revenue / spend : null;
}

function contributor(totals: EntityTotals): PaidMediaContributorEvidence | null {
  if (totals.currentSpend <= 0) return null;
  const currentPlatformRoas = platformRoas(totals.currentAttributedRevenue, totals.currentSpend);
  const previousPlatformRoas = platformRoas(totals.previousAttributedRevenue, totals.previousSpend);
  const roasDeterioration = previousPlatformRoas != null && previousPlatformRoas > 0 && currentPlatformRoas != null
    ? Math.max(0, (previousPlatformRoas - currentPlatformRoas) / previousPlatformRoas)
    : totals.currentAttributedRevenue <= 0 ? 1 : 0;
  const spendChange = totals.currentSpend - totals.previousSpend;
  const signals: PaidMediaContributorEvidence['signals'] = [];
  if (totals.previousSpend <= 0 && totals.currentSpend > 0) signals.push('new_spend');
  else if (spendChange > 0) signals.push('spend_increase');
  if (roasDeterioration > 0) signals.push('platform_roas_decline');
  if (totals.currentAttributedRevenue <= 0) signals.push('spend_without_platform_revenue');

  return {
    source: totals.identity.source,
    entityType: totals.identity.entityType,
    entityId: totals.identity.entityId,
    entityName: totals.identity.entityName,
    parentEntityId: totals.identity.parentEntityId,
    parentEntityName: totals.identity.parentEntityName,
    currentSpend: totals.currentSpend,
    previousSpend: totals.previousSpend,
    spendChange,
    currentAttributedRevenue: totals.currentAttributedRevenue,
    previousAttributedRevenue: totals.previousAttributedRevenue,
    currentPlatformRoas,
    previousPlatformRoas,
    platformRoasChangePercent: previousPlatformRoas != null && previousPlatformRoas > 0 && currentPlatformRoas != null
      ? ((currentPlatformRoas - previousPlatformRoas) / previousPlatformRoas) * 100
      : null,
    diagnosticScore: Math.max(0, spendChange) + totals.currentSpend * roasDeterioration,
    signals,
  };
}

export function diagnosePaidMediaContributors(
  rows: DailyPaidMediaEntityObservation[],
  currentStart: string,
  currentEnd: string,
  limitPerEntityType = 3,
): PaidMediaContributorEvidence[] {
  const windowDays = Math.round(
    (Date.parse(`${currentEnd}T00:00:00Z`) - Date.parse(`${currentStart}T00:00:00Z`)) / 86400000,
  ) + 1;
  if (windowDays <= 0 || limitPerEntityType <= 0) return [];
  const previousStart = addDays(currentStart, -windowDays);
  const previousEnd = addDays(currentStart, -1);
  const grouped = new Map<string, EntityTotals>();

  for (const row of rows) {
    const inCurrent = row.metricDate >= currentStart && row.metricDate <= currentEnd;
    const inPrevious = row.metricDate >= previousStart && row.metricDate <= previousEnd;
    if (!inCurrent && !inPrevious) continue;
    const key = `${row.source}:${row.accountId}:${row.entityType}:${row.entityId}`;
    const totals = grouped.get(key) ?? {
      identity: row,
      currentSpend: 0,
      previousSpend: 0,
      currentAttributedRevenue: 0,
      previousAttributedRevenue: 0,
    };
    if (inCurrent) {
      totals.currentSpend += finite(row.spend);
      totals.currentAttributedRevenue += finite(row.attributedRevenue);
      totals.identity = row;
    } else {
      totals.previousSpend += finite(row.spend);
      totals.previousAttributedRevenue += finite(row.attributedRevenue);
    }
    grouped.set(key, totals);
  }

  const ranked = [...grouped.values()]
    .map(contributor)
    .filter((item): item is PaidMediaContributorEvidence => item != null)
    .sort((left, right) => right.diagnosticScore - left.diagnosticScore
      || right.currentSpend - left.currentSpend
      || left.entityName.localeCompare(right.entityName));
  const output: PaidMediaContributorEvidence[] = [];
  for (const entityType of ['campaign', 'adset'] as PaidMediaEntityType[]) {
    output.push(...ranked.filter((item) => item.entityType === entityType).slice(0, limitPerEntityType));
  }
  return output;
}