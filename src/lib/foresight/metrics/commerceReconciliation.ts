import type { DataQualityIssue } from '../types';
import type { DailyPaidMediaObservation } from './marketingObservations';
import {
  calculateContributionMetrics,
  calculatePaidMediaEfficiency,
  type ContributionMetrics,
  type PaidMediaEfficiencyMetrics,
} from './financialMetrics';

export type CommerceChannel = 'online' | 'pos';

export interface DailyCommerceObservation {
  metricDate: string;
  channel: CommerceChannel;
  salesIncTax: number;
  salesTax: number;
  returnsIncTax: number;
  returnsTax: number;
  salesCogs: number;
  returnedCogs: number;
  orderCount: number;
  returnCount: number;
  costLineCount: number;
  missingCostLineCount: number;
  costBasis: 'captured' | 'estimated' | 'mixed';
}

export interface DailyCommerceReconciliation {
  metricDate: string;
  googleAdsSpend: number;
  metaAdsSpend: number;
  onlineNetRevenueExTax: number;
  posNetRevenueExTax: number;
  totalRetailNetRevenueExTax: number;
  paidMedia: PaidMediaEfficiencyMetrics;
  onlineContribution: ContributionMetrics;
  qualityIssues: DataQualityIssue[];
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function netRevenueExTax(observation: DailyCommerceObservation | undefined): number {
  if (!observation) return 0;
  const salesExTax = finite(observation.salesIncTax) - finite(observation.salesTax);
  const returnsExTax = finite(observation.returnsIncTax) - finite(observation.returnsTax);
  return salesExTax - returnsExTax;
}

function combineCommerce(
  current: DailyCommerceObservation | undefined,
  item: DailyCommerceObservation,
): DailyCommerceObservation {
  if (!current) return { ...item };
  return {
    ...current,
    salesIncTax: current.salesIncTax + item.salesIncTax,
    salesTax: current.salesTax + item.salesTax,
    returnsIncTax: current.returnsIncTax + item.returnsIncTax,
    returnsTax: current.returnsTax + item.returnsTax,
    salesCogs: current.salesCogs + item.salesCogs,
    returnedCogs: current.returnedCogs + item.returnedCogs,
    orderCount: current.orderCount + item.orderCount,
    returnCount: current.returnCount + item.returnCount,
    costLineCount: current.costLineCount + item.costLineCount,
    missingCostLineCount: current.missingCostLineCount + item.missingCostLineCount,
    costBasis: current.costBasis === item.costBasis ? current.costBasis : 'mixed',
  };
}

export function reconcileDailyCommerce(
  commerce: DailyCommerceObservation[],
  paidMedia: DailyPaidMediaObservation[],
): DailyCommerceReconciliation[] {
  const commerceByDateChannel = new Map<string, DailyCommerceObservation>();
  const paidByDate = new Map<string, { googleAdsSpend: number; metaAdsSpend: number }>();
  const dates = new Set<string>();

  for (const item of commerce) {
    const key = `${item.metricDate}:${item.channel}`;
    commerceByDateChannel.set(key, combineCommerce(commerceByDateChannel.get(key), item));
    dates.add(item.metricDate);
  }
  for (const item of paidMedia) {
    const current = paidByDate.get(item.metricDate) ?? { googleAdsSpend: 0, metaAdsSpend: 0 };
    if (item.source === 'google_ads') current.googleAdsSpend += finite(item.spend);
    if (item.source === 'meta_ads') current.metaAdsSpend += finite(item.spend);
    paidByDate.set(item.metricDate, current);
    dates.add(item.metricDate);
  }

  return [...dates].sort().map((metricDate) => {
    const online = commerceByDateChannel.get(`${metricDate}:online`);
    const pos = commerceByDateChannel.get(`${metricDate}:pos`);
    const spend = paidByDate.get(metricDate) ?? { googleAdsSpend: 0, metaAdsSpend: 0 };
    const onlineNetRevenueExTax = netRevenueExTax(online);
    const posNetRevenueExTax = netRevenueExTax(pos);
    const qualityIssues: DataQualityIssue[] = [];

    if (!online) {
      qualityIssues.push({
        code: 'missing_online_sales_observation',
        severity: 'warning',
        message: 'No authoritative online sales observation is available for this date.',
      });
    }
    if ((online?.missingCostLineCount ?? 0) > 0) {
      qualityIssues.push({
        code: 'incomplete_online_cogs',
        severity: 'blocking',
        message: `${online?.missingCostLineCount} online sale or return lines have no usable cost.`,
      });
    }

    const onlineCogs = online && online.missingCostLineCount === 0
      ? finite(online.salesCogs) - finite(online.returnedCogs)
      : null;
    const onlineContribution = calculateContributionMetrics({
      grossSalesIncTax: online?.salesIncTax ?? 0,
      returnsIncTax: online?.returnsIncTax ?? 0,
      netRevenueExTaxOverride: onlineNetRevenueExTax,
      cogs: onlineCogs,
      adSpend: spend.googleAdsSpend + spend.metaAdsSpend,
    });

    if (qualityIssues.some((issue) => issue.severity === 'blocking')) {
      for (const metric of Object.values(onlineContribution)) {
        metric.quality = {
          grade: 'blocked',
          issues: [...metric.quality.issues, ...qualityIssues],
        };
        if (metric.key !== 'net_revenue_ex_tax') metric.value = null;
      }
    }

    return {
      metricDate,
      googleAdsSpend: spend.googleAdsSpend,
      metaAdsSpend: spend.metaAdsSpend,
      onlineNetRevenueExTax,
      posNetRevenueExTax,
      totalRetailNetRevenueExTax: onlineNetRevenueExTax + posNetRevenueExTax,
      paidMedia: calculatePaidMediaEfficiency({
        backendNetOnlineRevenue: onlineNetRevenueExTax,
        googleAdsSpend: spend.googleAdsSpend,
        metaAdsSpend: spend.metaAdsSpend,
      }),
      onlineContribution,
      qualityIssues,
    };
  });
}