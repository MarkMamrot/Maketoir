import { ForesightMetricsService } from './ForesightMetricsService';
import { buildMarketingOperationalStatus } from './marketingOperationalStatus';
import { ForesightCampaignExperimentResultRepository } from './repositories/ForesightCampaignExperimentResultRepository';
import { ForesightExecutionRepository } from './repositories/ForesightExecutionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';
import type { RecommendationState } from './types';

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function loadAssistantMarketingPerformance(input: {
  businessId: string;
  fromDate: string;
  toDate: string;
}) {
  const metrics = await ForesightMetricsService.getDailyMarketingMetrics(
    input.businessId,
    input.fromDate,
    input.toDate,
  );

  const paidMedia = ['google_ads', 'meta_ads'].map(source => {
    const rows = metrics.paidMedia.filter(row => row.source === source);
    const spend = sum(rows.map(row => row.spend));
    const attributedRevenue = sum(rows.map(row => row.attributedRevenue));
    const currencies = [...new Set(rows.map(row => row.currencyCode).filter(Boolean))];
    return {
      source,
      daysWithData: new Set(rows.map(row => row.metricDate)).size,
      spend: rounded(spend),
      impressions: sum(rows.map(row => row.impressions)),
      clicks: sum(rows.map(row => row.clicks)),
      conversions: rounded(sum(rows.map(row => row.conversions))),
      attributedRevenue: rounded(attributedRevenue),
      platformRoas: spend > 0 ? rounded(attributedRevenue / spend) : null,
      currency: currencies.length === 1 ? currencies[0] : null,
      mixedCurrencies: currencies.length > 1,
    };
  });

  const commerce = ['online', 'pos'].map(channel => {
    const rows = metrics.commerce.filter(row => row.channel === channel);
    const salesTaxInclusive = sum(rows.map(row => row.salesIncTax));
    const returnsTaxInclusive = sum(rows.map(row => row.returnsIncTax));
    const extractedTax = sum(rows.map(row => row.salesTax - row.returnsTax));
    const costLines = sum(rows.map(row => row.costLineCount));
    const missingCostLines = sum(rows.map(row => row.missingCostLineCount));
    return {
      channel,
      daysWithData: new Set(rows.map(row => row.metricDate)).size,
      salesTaxInclusive: rounded(salesTaxInclusive),
      returnsTaxInclusive: rounded(returnsTaxInclusive),
      netSalesTaxInclusive: rounded(salesTaxInclusive - returnsTaxInclusive),
      extractedTax: rounded(extractedTax),
      netRevenueTaxExclusive: rounded(salesTaxInclusive - returnsTaxInclusive - extractedTax),
      orderCount: sum(rows.map(row => row.orderCount)),
      returnCount: sum(rows.map(row => row.returnCount)),
      costCoveragePercent: costLines + missingCostLines > 0
        ? rounded(costLines / (costLines + missingCostLines) * 100)
        : null,
    };
  });

  const qualityIssues = [...new Map(metrics.reconciliation
    .flatMap(row => row.qualityIssues)
    .map(issue => [issue.code, { code: issue.code, severity: issue.severity, message: issue.message }])).values()];
  const paidMediaSpend = sum(metrics.reconciliation.map(row => row.paidMedia.paidMediaSpend));
  const onlineNetRevenueTaxExclusive = sum(metrics.reconciliation.map(row => row.onlineNetRevenueExTax));
  const dates = [...new Set([
    ...metrics.paidMedia.map(row => row.metricDate),
    ...metrics.commerce.map(row => row.metricDate),
  ])].sort();

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    latestDataDate: dates.at(-1) ?? null,
    paidMedia,
    commerce,
    totals: {
      paidMediaSpend: rounded(paidMediaSpend),
      onlineNetRevenueTaxExclusive: rounded(onlineNetRevenueTaxExclusive),
      posNetRevenueTaxExclusive: rounded(sum(metrics.reconciliation.map(row => row.posNetRevenueExTax))),
      paidMediaEcommerceMer: paidMediaSpend > 0 ? rounded(onlineNetRevenueTaxExclusive / paidMediaSpend) : null,
    },
    quality: {
      grade: qualityIssues.some(issue => issue.severity === 'blocking')
        ? 'blocked'
        : qualityIssues.length > 0 ? 'partial' : 'good',
      issues: qualityIssues,
    },
  };
}

const RECOMMENDATION_STATES: RecommendationState[] = [
  'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'compensated', 'rejected',
];

export async function loadAssistantMarketingRecommendations(input: {
  businessId: string;
  businessToday: string;
  states?: RecommendationState[];
  limit?: number;
}) {
  const requestedStates = input.states?.length ? input.states : RECOMMENDATION_STATES;
  const limit = Math.min(20, Math.max(1, Math.trunc(input.limit ?? 20)));
  const allRecommendations = await ForesightRepository.listRecommendations(input.businessId, requestedStates);
  const recommendations = allRecommendations.slice(0, limit);
  const recommendationIds = recommendations.map(item => item.id);
  const [outcomes, implementations, executions, experimentWorkflows] = await Promise.all([
    ForesightRepository.listRecommendationOutcomes(input.businessId, recommendationIds),
    ForesightRepository.listRecommendationImplementations(input.businessId, recommendationIds),
    ForesightExecutionRepository.listForRecommendations(input.businessId, recommendationIds),
    ForesightCampaignExperimentResultRepository.listWorkflowForRecommendations(input.businessId, recommendationIds),
  ]);

  const rows = recommendations.map(recommendation => {
    const implementation = implementations.find(item => item.recommendation_id === recommendation.id);
    const execution = executions.find(item => item.recommendation_id === recommendation.id
      && item.compensates_execution_id == null && item.state === 'succeeded');
    const experiment = experimentWorkflows.find(item => item.recommendation_id === recommendation.id);
    const completionDate = implementation?.implemented_on
      ?? (typeof execution?.completion_date === 'string' ? execution.completion_date : null);
    const operationalStatus = buildMarketingOperationalStatus({
      recommendationId: recommendation.id,
      businessToday: input.businessToday,
      completionDate,
      hasOutcome: outcomes.some(item => item.recommendation_id === recommendation.id),
      experiment: experiment ? {
        scheduledEndOn: experiment.scheduled_end_on,
        conclusion: experiment.conclusion,
        conclusionReview: experiment.conclusion_review,
      } : null,
    });
    const observedValues = Object.fromEntries(Object.entries(recommendation.evidence_json.observedValues ?? {})
      .filter(([, value]) => value == null || Number.isFinite(Number(value)))
      .slice(0, 12));

    return {
      recommendationId: recommendation.id,
      state: recommendation.state,
      channel: recommendation.channel,
      ruleId: recommendation.rule_id,
      evidenceWindow: {
        from: recommendation.evidence_json.windowStart,
        to: recommendation.evidence_json.windowEnd,
      },
      evidenceQuality: {
        grade: recommendation.evidence_json.quality.grade,
        issues: recommendation.evidence_json.quality.issues.slice(0, 10).map(issue => ({
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
        })),
      },
      observedValues,
      actionType: typeof recommendation.proposed_action_json?.type === 'string'
        ? recommendation.proposed_action_json.type
        : null,
      confidencePercent: recommendation.confidence == null
        ? null
        : rounded(Number(recommendation.confidence) * 100),
      expectedImpact: {
        low: recommendation.expected_impact_low == null ? null : Number(recommendation.expected_impact_low),
        high: recommendation.expected_impact_high == null ? null : Number(recommendation.expected_impact_high),
      },
      expiresAt: recommendation.expires_at,
      createdAt: recommendation.created_at,
      operationalStatus,
    };
  });

  return {
    businessToday: input.businessToday,
    rows,
    truncated: allRecommendations.length > limit,
  };
}
