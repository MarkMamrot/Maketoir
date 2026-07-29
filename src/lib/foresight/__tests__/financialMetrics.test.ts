import { describe, expect, it } from 'vitest';
import {
  calculateContributionMetrics,
  calculatePaidMediaEfficiency,
  extractTaxExclusive,
} from '../metrics/financialMetrics';

describe('Foresight financial metrics', () => {
  it('extracts GST from tax-inclusive revenue', () => {
    expect(extractTaxExclusive(110, 10)).toBeCloseTo(100);
  });

  it('uses exact source tax when a net tax-exclusive override is supplied', () => {
    const result = calculateContributionMetrics({
      grossSalesIncTax: 110,
      netRevenueExTaxOverride: 95,
      cogs: 40,
      shippingSubsidy: 0,
      paymentFees: 0,
    });

    expect(result.netRevenueExTax.value).toBe(95);
    expect(result.grossProfit.value).toBe(55);
  });

  it('calculates contribution economics from net tax-exclusive sales', () => {
    const result = calculateContributionMetrics({
      grossSalesIncTax: 1_100,
      returnsIncTax: 110,
      discountsIncTax: 110,
      cogs: 400,
      shippingSubsidy: 40,
      paymentFees: 16,
      adSpend: 100,
    });

    expect(result.netRevenueExTax.value).toBeCloseTo(800);
    expect(result.grossProfit.value).toBeCloseTo(400);
    expect(result.contributionProfitBeforeAds.value).toBeCloseTo(344);
    expect(result.contributionMarginPct.value).toBeCloseTo(43);
    expect(result.breakEvenRoas.value).toBeCloseTo(1 / 0.43);
    expect(result.contributionPoas.value).toBeCloseTo(3.44);
  });

  it('blocks profit metrics when COGS is missing', () => {
    const result = calculateContributionMetrics({
      grossSalesIncTax: 550,
      cogs: null,
      shippingSubsidy: 0,
      paymentFees: 0,
      adSpend: 50,
    });

    expect(result.netRevenueExTax.value).toBeCloseTo(500);
    expect(result.grossProfit.value).toBeNull();
    expect(result.contributionPoas.value).toBeNull();
    expect(result.contributionPoas.quality.grade).toBe('blocked');
    expect(result.contributionPoas.quality.issues).toContainEqual(expect.objectContaining({ code: 'missing_cogs' }));
  });

  it('marks optional contribution costs as partial when unavailable', () => {
    const result = calculateContributionMetrics({
      grossSalesIncTax: 220,
      cogs: 100,
      adSpend: 20,
    });

    expect(result.contributionProfitBeforeAds.value).toBeCloseTo(100);
    expect(result.contributionProfitBeforeAds.quality.grade).toBe('partial');
    expect(result.contributionProfitBeforeAds.quality.issues.map((issue) => issue.code)).toEqual([
      'missing_shipping_subsidy',
      'missing_payment_fees',
    ]);
  });

  it('does not produce POAS when ad spend is zero', () => {
    const result = calculateContributionMetrics({
      grossSalesIncTax: 220,
      cogs: 100,
      shippingSubsidy: 0,
      paymentFees: 0,
      adSpend: 0,
    });

    expect(result.contributionPoas.value).toBeNull();
    expect(result.contributionPoas.quality.grade).toBe('partial');
  });

  it('keeps Klaviyo attribution out of backend revenue and MER', () => {
    const result = calculatePaidMediaEfficiency({
      backendNetOnlineRevenue: 1_000,
      googleAdsSpend: 100,
      metaAdsSpend: 100,
      klaviyoAttributedRevenue: 300,
    });

    expect(result.paidMediaSpend).toBe(200);
    expect(result.paidMediaMer.value).toBe(5);
    expect(result.klaviyoAttributedRevenue.value).toBe(300);
  });
});