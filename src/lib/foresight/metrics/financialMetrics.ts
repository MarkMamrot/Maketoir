import type { DataQualityIssue, DataQualityResult, ForesightMetric } from '../types';

export const FINANCIAL_FORMULA_VERSION = 'foresight-financial-v1';

export interface ContributionInput {
  grossSalesIncTax: number;
  returnsIncTax?: number;
  discountsIncTax?: number;
  taxRatePercent?: number;
  netRevenueExTaxOverride?: number;
  cogs: number | null;
  shippingSubsidy?: number | null;
  paymentFees?: number | null;
  adSpend?: number;
}

export interface ContributionMetrics {
  netRevenueExTax: ForesightMetric;
  grossProfit: ForesightMetric;
  grossMarginPct: ForesightMetric;
  contributionProfitBeforeAds: ForesightMetric;
  contributionMarginPct: ForesightMetric;
  breakEvenRoas: ForesightMetric;
  contributionPoas: ForesightMetric;
}

export interface PaidMediaEfficiencyInput {
  backendNetOnlineRevenue: number;
  googleAdsSpend: number;
  metaAdsSpend: number;
  klaviyoAttributedRevenue?: number;
}

export interface PaidMediaEfficiencyMetrics {
  paidMediaSpend: number;
  paidMediaMer: ForesightMetric;
  klaviyoAttributedRevenue: ForesightMetric;
}

function quality(issues: DataQualityIssue[] = []): DataQualityResult {
  return {
    grade: issues.some((issue) => issue.severity === 'blocking')
      ? 'blocked'
      : issues.length > 0
        ? 'partial'
        : 'good',
    issues,
  };
}

function metric(key: string, value: number | null, issues: DataQualityIssue[] = []): ForesightMetric {
  return { key, value, formulaVersion: FINANCIAL_FORMULA_VERSION, quality: quality(issues) };
}

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function extractTaxExclusive(amountIncTax: number, taxRatePercent = 10): number {
  if (!Number.isFinite(amountIncTax)) return 0;
  if (!Number.isFinite(taxRatePercent) || taxRatePercent <= 0) return amountIncTax;
  return amountIncTax / (1 + taxRatePercent / 100);
}

export function calculateContributionMetrics(input: ContributionInput): ContributionMetrics {
  const netRevenueIncTax = finiteOrZero(input.grossSalesIncTax)
    - finiteOrZero(input.returnsIncTax)
    - finiteOrZero(input.discountsIncTax);
  const netRevenueExTax = input.netRevenueExTaxOverride == null
    ? extractTaxExclusive(netRevenueIncTax, input.taxRatePercent ?? 10)
    : finiteOrZero(input.netRevenueExTaxOverride);

  const costIssues: DataQualityIssue[] = input.cogs == null
    ? [{ code: 'missing_cogs', severity: 'blocking', message: 'COGS is required for profit metrics.' }]
    : [];
  const contributionIssues = [...costIssues];
  if (input.shippingSubsidy == null) {
    contributionIssues.push({
      code: 'missing_shipping_subsidy',
      severity: 'warning',
      message: 'Shipping subsidy is unavailable and has been treated as zero.',
    });
  }
  if (input.paymentFees == null) {
    contributionIssues.push({
      code: 'missing_payment_fees',
      severity: 'warning',
      message: 'Payment fees are unavailable and have been treated as zero.',
    });
  }

  const grossProfit = input.cogs == null ? null : netRevenueExTax - input.cogs;
  const grossMarginPct = grossProfit == null || netRevenueExTax <= 0
    ? null
    : (grossProfit / netRevenueExTax) * 100;
  const contributionProfit = grossProfit == null
    ? null
    : grossProfit - finiteOrZero(input.shippingSubsidy) - finiteOrZero(input.paymentFees);
  const contributionMarginPct = contributionProfit == null || netRevenueExTax <= 0
    ? null
    : (contributionProfit / netRevenueExTax) * 100;
  const breakEvenRoas = contributionMarginPct != null && contributionMarginPct > 0
    ? 1 / (contributionMarginPct / 100)
    : null;
  const adSpend = finiteOrZero(input.adSpend);
  const contributionPoas = contributionProfit != null && adSpend > 0
    ? contributionProfit / adSpend
    : null;
  const poasIssues = [...contributionIssues];
  if (adSpend <= 0) {
    poasIssues.push({ code: 'zero_ad_spend', severity: 'warning', message: 'POAS requires positive ad spend.' });
  }

  return {
    netRevenueExTax: metric('net_revenue_ex_tax', netRevenueExTax),
    grossProfit: metric('gross_profit', grossProfit, costIssues),
    grossMarginPct: metric('gross_margin_pct', grossMarginPct, costIssues),
    contributionProfitBeforeAds: metric('contribution_profit_before_ads', contributionProfit, contributionIssues),
    contributionMarginPct: metric('contribution_margin_pct', contributionMarginPct, contributionIssues),
    breakEvenRoas: metric('break_even_roas', breakEvenRoas, contributionIssues),
    contributionPoas: metric('contribution_poas', contributionPoas, poasIssues),
  };
}

export function calculatePaidMediaEfficiency(input: PaidMediaEfficiencyInput): PaidMediaEfficiencyMetrics {
  const paidMediaSpend = finiteOrZero(input.googleAdsSpend) + finiteOrZero(input.metaAdsSpend);
  const merIssues: DataQualityIssue[] = paidMediaSpend > 0
    ? []
    : [{ code: 'zero_paid_media_spend', severity: 'warning', message: 'MER requires positive paid-media spend.' }];

  return {
    paidMediaSpend,
    paidMediaMer: metric(
      'paid_media_ecommerce_mer',
      paidMediaSpend > 0 ? finiteOrZero(input.backendNetOnlineRevenue) / paidMediaSpend : null,
      merIssues,
    ),
    klaviyoAttributedRevenue: metric(
      'klaviyo_attributed_revenue',
      finiteOrZero(input.klaviyoAttributedRevenue),
    ),
  };
}
